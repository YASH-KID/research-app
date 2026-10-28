// In-memory job store. This is a single-user localhost tool with no persistence
// requirement across server restarts — jobs are ephemeral by design, the way a
// simple progress spinner would be, just decoupled so long-running work doesn't
// block the HTTP response.

const jobs = new Map();

function createJob(type, topicId) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const job = {
    id,
    type,
    topicId,
    status: "running", // running | done | error
    progress: { stage: "starting", found: 0, total: 0 },
    result: null,
    error: null,
    createdAt: Date.now()
  };
  jobs.set(id, job);
  return job;
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  if (patch.progress) job.progress = { ...job.progress, ...patch.progress };
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

// Prevent unbounded growth over a long-running server process.
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff && job.status !== "running") jobs.delete(id);
  }
}, 5 * 60 * 1000).unref();

module.exports = { createJob, updateJob, getJob };
