import { db } from '../db.js'

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000

async function cleanupOldDrafts() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const result = await db.aggregatedPost.deleteMany({
    where: {
      publishStatus: 'DRAFT',
      createdAt: { lt: sevenDaysAgo },
    },
  })

  if (result.count > 0) {
    console.log(`[cleaner] Deleted ${result.count} unpublished draft(s) older than 7 days`)
  }
}

export function startCleanerWorker() {
  console.log('[cleaner] Starting cleanup worker (runs every 24h)')
  cleanupOldDrafts().catch(err => console.error('[cleaner] Initial cleanup failed:', err))
  setInterval(() => {
    cleanupOldDrafts().catch(err => console.error('[cleaner] Cleanup failed:', err))
  }, CLEANUP_INTERVAL_MS)
}
