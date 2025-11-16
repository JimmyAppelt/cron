#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENVATO_API_TOKEN = process.env.ENVATO_API_TOKEN

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
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
}

if (ENVATO_API_TOKEN) {
  headers['Authorization'] = `Bearer ${ENVATO_API_TOKEN}`
}

async function fetchPopularItems() {
  try {
    console.log('Fetching popular items from Envato API...')
    const response = await fetch('https://api.envato.com/v1/market/popular:themeforest.json', {
      headers,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`API Error (${response.status}):`, errorText)
      process.exit(1)
    }

    const data = await response.json()
    const itemsLastWeek = data.popular.items_last_week || []
    const itemsLastThreeMonths = data.popular.items_last_three_months || []
    const authorsLastMonth = data.popular.authors_last_month || []

    console.log(`Fetched ${itemsLastWeek.length} items from last week`)
    console.log(`Fetched ${itemsLastThreeMonths.length} items from last 3 months`)
    console.log(`Fetched ${authorsLastMonth.length} authors from last month`)

    // Prepare items from last week
    const itemsLastWeekToUpsert = itemsLastWeek.map((item) => ({
      id: item.id,
      item: item.item,
      url: item.url,
      user: item.user,
      thumbnail: item.thumbnail,
      sales: item.sales,
      rating: item.rating,
      rating_decimal: item.rating_decimal,
      cost: item.cost,
      uploaded_on: item.uploaded_on,
      last_update: item.last_update,
      tags: item.tags,
      category: item.category,
      live_preview_url: item.live_preview_url,
      fetched_at: new Date().toISOString(),
    }))

    // Prepare items from last 3 months
    const itemsLastThreeMonthsToUpsert = itemsLastThreeMonths.map((item) => ({
      id: item.id,
      item: item.item,
      url: item.url,
      user: item.user,
      thumbnail: item.thumbnail,
      sales: item.sales,
      rating: item.rating,
      rating_decimal: item.rating_decimal,
      cost: item.cost,
      uploaded_on: item.uploaded_on,
      last_update: item.last_update,
      tags: item.tags,
      category: item.category,
      live_preview_url: item.live_preview_url,
      fetched_at: new Date().toISOString(),
    }))

    // Prepare authors
    const authorsToUpsert = authorsLastMonth.map((author) => ({
      username: author.item,
      sales: author.sales,
      url: author.url,
      image: author.image,
      fetched_at: new Date().toISOString(),
    }))

    // Upsert items from last week
    const { error: errorLastWeek } = await supabase
      .from('popular_themeforest_items_last_week')
      .upsert(itemsLastWeekToUpsert, {
        onConflict: 'id',
      })

    if (errorLastWeek) {
      console.error('Error upserting last week items:', errorLastWeek)
      process.exit(1)
    }

    // Upsert items from last 3 months
    const { error: errorLastThreeMonths } = await supabase
      .from('popular_themeforest_items_last_three_months')
      .upsert(itemsLastThreeMonthsToUpsert, {
        onConflict: 'id',
      })

    if (errorLastThreeMonths) {
      console.error('Error upserting last 3 months items:', errorLastThreeMonths)
      process.exit(1)
    }

    // Upsert authors
    const { error: errorAuthors } = await supabase
      .from('popular_themeforest_authors_last_month')
      .upsert(authorsToUpsert, {
        onConflict: 'username',
      })

    if (errorAuthors) {
      console.error('Error upserting authors:', errorAuthors)
      process.exit(1)
    }

    console.log(`Successfully stored ${itemsLastWeek.length} items from last week`)
    console.log(`Successfully stored ${itemsLastThreeMonths.length} items from last 3 months`)
    console.log(`Successfully stored ${authorsLastMonth.length} authors`)
  } catch (error) {
    console.error('FATAL ERROR fetching popular items:', error)
    console.error('Stack trace:', error.stack)
    process.exit(1)
  }
}

fetchPopularItems()
