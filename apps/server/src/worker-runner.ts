import 'dotenv/config'
import { initSentry } from './lib/sentry.js'
initSentry()

import { startFetchWorker }        from './workers/fetcher.js'
import { startPublishWorker }       from './workers/publisher.js'
import { startSummarizerWorker }    from './workers/summarizer.js'
import { startSchedPublishWorker, applyScheduledPublishSettings } from './workers/schedPublisher.js'
import { startCleanerWorker }      from './workers/cleaner.js'
import { registerSourceSchedulers } from './routes/sources.js'

console.log('[worker] starting workers...')

startFetchWorker()
startPublishWorker()
startSummarizerWorker()
startSchedPublishWorker()
startCleanerWorker()

registerSourceSchedulers()
  .then(() => applyScheduledPublishSettings())
  .then(() => console.log('[worker] all workers running'))
  .catch(err => { console.error('[worker] startup error:', err); process.exit(1) })
