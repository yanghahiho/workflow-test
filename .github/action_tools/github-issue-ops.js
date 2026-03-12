const { runGraphql } = require('./graphql-file-loader');

const GRAPHQL_READ_FILE = '.github/graphql/query-read.graphql';

// 실행 컨텍스트 기준 레포 풀네임("owner/repo")을 반환한다.
function resolveExpectedRepoFullName({ context }) {
  return `${context.repo.owner}/${context.repo.repo}`.toLowerCase();
}

// 실제 레포와 기대 레포가 다르면 교차 레포 오염으로 간주하고 예외를 던진다.
function assertSameRepoOrThrow({ actualRepo, expectedRepo, label }) {
  const normalizedActual = String(actualRepo || '').toLowerCase();
  const normalizedExpected = String(expectedRepo || '').toLowerCase();
  if (!normalizedActual || normalizedActual !== normalizedExpected) {
    throw new Error(`[REPO_GUARD] ${label} 레포 불일치: actual='${actualRepo || 'unknown'}', expected='${expectedRepo}'`);
  }
}

// 이슈를 생성하고 핵심 식별값을 반환한다.
async function createIssue({ github, context, title, body }) {
  const created = await github.rest.issues.create({
    owner: context.repo.owner,
    repo: context.repo.repo,
    title,
    body,
  });

  return {
    number: created.data.number,
    node_id: created.data.node_id,
    title: created.data.title,
    state: created.data.state,
  };
}

// open [UV] 이슈를 단일 타겟으로 조회한다. (0개/2개 이상이면 invariant 위반)
async function findOpenUvIssueOrThrow({ github, context, perPage = 10 }) {
  const resp = await github.rest.search.issuesAndPullRequests({
    q: `repo:${context.repo.owner}/${context.repo.repo} is:issue state:open "[UV]" in:title`,
    per_page: perPage,
  });

  const items = (resp?.data?.items || []).filter((item) => !item.pull_request);
  if (items.length === 0) {
    throw new Error('open [UV] 이슈를 찾을 수 없습니다.');
  }
  if (items.length > 1) {
    throw new Error(`open [UV] 이슈가 ${items.length}개입니다. 단일 UV invariant 위반입니다.`);
  }

  const uv = items[0];
  return {
    number: uv.number,
    node_id: uv.node_id,
    title: uv.title,
    state: uv.state,
  };
}

// 번호로 지정된 부모 이슈를 조회하고 open 상태인지 검증한다.
async function findOpenIssueByNumberOrThrow({ github, context, issueNumber }) {
  const resp = await github.rest.issues.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: Number(issueNumber),
  });

  if (resp?.data?.pull_request) {
    throw new Error(`지정된 부모 #${issueNumber}는 이슈가 아니라 PR입니다.`);
  }
  if (resp?.data?.state !== 'open') {
    throw new Error(`지정된 부모 #${issueNumber}는 open 상태가 아닙니다.`);
  }

  return {
    number: resp.data.number,
    node_id: resp.data.node_id,
    title: resp.data.title,
    state: resp.data.state,
  };
}

// open RC 이슈 목록을 조회한다.
async function findOpenRcIssues({ github, context, perPage = 50 }) {
  const resp = await github.rest.search.issuesAndPullRequests({
    q: `repo:${context.repo.owner}/${context.repo.repo} is:issue state:open "[RC]" in:title`,
    per_page: perPage,
  });

  return (resp?.data?.items || [])
    .filter((item) => !item.pull_request)
    .map((item) => ({
      number: item.number,
      node_id: item.node_id,
      title: item.title,
      state: item.state,
    }));
}

// 번호 목록 이슈를 close 처리하고 성공/실패 건수와 성공 번호 목록을 반환한다.
async function closeIssuesByNumbers({ github, context, issueNumbers }) {
  let closedCount = 0;
  let failedCount = 0;
  const closedIssueNumbers = [];

  for (const number of issueNumbers || []) {
    try {
      await github.rest.issues.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: Number(number),
        state: 'closed',
      });
      closedCount += 1;
      closedIssueNumbers.push(Number(number));
    } catch (e) {
      failedCount += 1;
    }
  }

  return { closedCount, failedCount, closedIssueNumbers };
}

// Node ID로 이슈 번호/상태를 조회한다.
async function resolveIssueNumberStateByNodeId({ github, issueNodeId }) {
  const data = await runGraphql({
    github,
    filePath: GRAPHQL_READ_FILE,
    operationName: 'GetIssueNumberState',
    variables: { id: issueNodeId },
  });

  return {
    number: data?.node?.number ? Number(data.node.number) : null,
    state: data?.node?.state || null,
    repository: data?.node?.repository?.nameWithOwner || null,
  };
}

module.exports = {
  resolveExpectedRepoFullName,
  assertSameRepoOrThrow,
  createIssue,
  findOpenUvIssueOrThrow,
  findOpenIssueByNumberOrThrow,
  findOpenRcIssues,
  closeIssuesByNumbers,
  resolveIssueNumberStateByNodeId,
};
