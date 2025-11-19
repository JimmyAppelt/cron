#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENVATO_API_TOKEN = process.env.ENVATO_API_TOKEN
const BURST_DELAY = 250

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

if (!ENVATO_API_TOKEN) {
  console.error('Error: ENVATO_API_TOKEN must be set')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

const headers = {
  'User-Agent': 'DataVato/1.0',
  Authorization: `Bearer ${ENVATO_API_TOKEN}`,
}

async function fetchItemDetails(itemId) {
  try {
    const response = await fetch(`https://api.envato.com/v3/market/catalog/item?id=${itemId}`, {
      headers,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`API Error for item ${itemId} (${response.status}):`, errorText)
      return null
    }

    return await response.json()
  } catch (error) {
    console.error(`Error fetching item ${itemId}:`, error.message)
    return null
  }
}

async function getTodaysSalesRecord(itemId) {
  try {
    // Get today's date boundaries in UTC
    const now = new Date()
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    )
    const todayEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
    )

    const { data, error } = await supabase
      .from('item_sales')
      .select('id, number_of_sales, recorded_at')
      .eq('item_id', itemId)
      .gte('recorded_at', todayStart.toISOString())
      .lte('recorded_at', todayEnd.toISOString())
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single()

    if (error) {
      // PGRST116 = no rows returned (no record for today yet)
      if (error.code === 'PGRST116') {
        return null // No record for today - will insert
      }
      console.error(`Error fetching today's sales for item ${itemId}:`, error)
      return null
    }

    return data // Returns { id, number_of_sales, recorded_at }
  } catch (error) {
    console.error(`Error in getTodaysSalesRecord for item ${itemId}:`, error.message)
    return null
  }
}

async function fetchItemSales() {
  try {
    console.log('Fetching popular items from database...')
    const { data: allPopularItems, error: fetchError } = await supabase
      .from('popular_themeforest_items_last_week')
      .select('id, sales')
      .limit(200) // Fetch more to ensure we get the top 50 by sales

    if (fetchError) {
      console.error('Error fetching popular items:', fetchError)
      process.exit(1)
    }

    if (!allPopularItems || allPopularItems.length === 0) {
      console.log('No popular items found in database')
      return
    }

    // Sort by sales (highest first) and take top 50 most popular items
    const popularItems = allPopularItems
      .sort((a, b) => {
        // Convert sales string to number
        const salesA = parseInt(a.sales || '0', 10)
        const salesB = parseInt(b.sales || '0', 10)
        return salesB - salesA // Descending order (highest sales first)
      })
      .slice(0, 50)
      .map((item) => ({ id: item.id })) // Keep only id for processing

    console.log(`Found ${popularItems.length} most popular items to process`)

    let insertCount = 0
    let updateCount = 0
    let skippedCount = 0
    let errorCount = 0

    for (const item of popularItems) {
      const itemData = await fetchItemDetails(item.id)

      if (!itemData) {
        errorCount++
        continue
      }

      const currentSales = itemData.number_of_sales || 0

      // Check if we already have a record for today
      const todaysRecord = await getTodaysSalesRecord(item.id)

      if (todaysRecord !== null && currentSales <= todaysRecord.number_of_sales) {
        skippedCount++
        console.log(`⊘ Skipped item ${item.id}: sales unchanged today (${currentSales})`)
        // Small delay even when skipping to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, BURST_DELAY))
        continue
      }

      const salesData = {
        item_id: item.id,
        name: itemData.name || '',
        number_of_sales: currentSales,
        author_username: itemData.author_username || null,
        author_url: itemData.author_url || null,
        url: itemData.url || '',
        updated_at: itemData.updated_at || null,
        price_cents: itemData.price_cents || null,
        rating: itemData.rating || null,
        rating_count: itemData.rating_count || null,
        published_at: itemData.published_at || null,
        trending: itemData.trending || false,
        recorded_at: new Date().toISOString(),
      }

      if (todaysRecord) {
        // Update today's existing record
        const { error: updateError } = await supabase
          .from('item_sales')
          .update(salesData)
          .eq('id', todaysRecord.id)

        if (updateError) {
          console.error(`Error updating sales data for item ${item.id}:`, updateError)
          errorCount++
        } else {
          updateCount++
          console.log(
            `↻ Updated sales for item ${item.id}: ${currentSales} sales (was ${todaysRecord.number_of_sales})`,
          )
        }
      } else {
        // Insert new record for today
        const { error: insertError } = await supabase.from('item_sales').insert(salesData)

        if (insertError) {
          console.error(`Error inserting sales data for item ${item.id}:`, insertError)
          errorCount++
        } else {
          insertCount++
          console.log(`✓ Inserted new sales record for item ${item.id}: ${currentSales} sales`)
        }
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, BURST_DELAY))
    }

    console.log(
      `\nCompleted: ${insertCount} inserted, ${updateCount} updated, ${skippedCount} skipped, ${errorCount} errors`,
    )

    const totalSuccess = insertCount + updateCount
    // Exit with error code only if all items failed or there was a critical error
    if (totalSuccess === 0 && skippedCount === 0 && errorCount > 0) {
      console.error('ERROR: All items failed to process')
      process.exit(1)
    } else if (errorCount > 0) {
      console.warn(
        `WARNING: ${errorCount} items failed, but ${totalSuccess} succeeded and ${skippedCount} skipped`,
      )
      // Exit with 0 for partial success - workflow will show as success but with warnings
      process.exit(0)
    }
  } catch (error) {
    console.error('FATAL ERROR fetching item sales:', error)
    process.exit(1)
  }
}

fetchItemSales()
