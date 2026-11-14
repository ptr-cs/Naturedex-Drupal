// Publishes the sanitized test summary to the "status" branch, which the site's
// /status page reads. Runs in CI after the tests. The first run creates the
// branch, with no history shared with main.
const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, SUMMARY, IMAGE_RESULT } = process.env;
const api = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;
const headers = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'naturedex-ci',
};
const call = async (path, init = {}) => {
  const response = await fetch(`${api}${path}`, { headers, ...init });
  if (!response.ok && response.status !== 404)
    throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status}`);
  return response;
};

const current = await call('/contents/status.json?ref=status');
const { sha, content } = current.ok ? await current.json() : {};
const previous = content ? JSON.parse(Buffer.from(content, 'base64').toString('utf8')) : {};

const suites = JSON.parse(SUMMARY || '{}');
const at = new Date().toISOString();
const counts = Object.values(suites);
const ok =
  IMAGE_RESULT === 'success' &&
  counts.length === 4 &&
  counts.every((suite) => suite.failed === 0 && suite.passed > 0);

const status = {
  at,
  commit: GITHUB_SHA.slice(0, 7),
  suites,
  image: IMAGE_RESULT === 'success' ? 'passed' : 'failed',
  history: [{ at, ok }, ...(previous.history ?? [])].slice(0, 20),
};
const body = `${JSON.stringify(status, null, 2)}\n`;

if (current.ok) {
  await call('/contents/status.json', {
    method: 'PUT',
    body: JSON.stringify({
      branch: 'status',
      message: 'Update test status',
      sha,
      content: Buffer.from(body).toString('base64'),
    }),
  });
} else {
  const post = async (path, payload) =>
    (await call(path, { method: 'POST', body: JSON.stringify(payload) })).json();
  const tree = await post('/git/trees', {
    tree: [{ path: 'status.json', mode: '100644', type: 'blob', content: body }],
  });
  const commit = await post('/git/commits', {
    message: 'Start the test status branch',
    tree: tree.sha,
    parents: [],
  });
  const ref = await call('/git/refs', {
    method: 'POST',
    body: JSON.stringify({ ref: 'refs/heads/status', sha: commit.sha }),
  });
  if (!ref.ok) throw new Error(`Could not create the status branch: ${ref.status}`);
}
console.log(`Published status for ${status.commit}: ${ok ? 'passing' : 'failing'}`);
