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
    const items = data.popular.items_last_week || []

    console.log(`Fetched ${items.length} popular items`)

    // Upsert items into database
    const itemsToUpsert = items.map((item) => ({
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

    const { error } = await supabase.from('popular_themeforest').upsert(itemsToUpsert, {
      onConflict: 'id',
    })

    if (error) {
      console.error('Error upserting items:', error)
      process.exit(1)
    }

    console.log(`Successfully stored ${items.length} popular items`)
  } catch (error) {
    console.error('FATAL ERROR fetching popular items:', error)
    console.error('Stack trace:', error.stack)
    process.exit(1)
  }
}

fetchPopularItems()
