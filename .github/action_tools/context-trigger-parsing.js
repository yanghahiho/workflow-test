// 이슈 이벤트 payload에서 번호/노드ID/제목/본문을 표준 형태로 추출한다.
function parseIssueContext({ context }) {
  const issue = context.payload.issue;
  return {
    issueNumber: Number(issue.number),
    issueNodeId: issue.node_id,
    issueTitle: issue.title || '',
    issueBody: issue.body || '',
  };
}

// PR 이벤트 payload에서 번호/노드ID/타깃 브랜치/드래프트 여부를 표준 형태로 추출한다.
function parsePullRequestContext({ context }) {
  const pr = context.payload.pull_request;
  return {
    pullRequestNumber: Number(pr.number),
    pullRequestNodeId: pr.node_id,
    baseRef: pr.base?.ref || '',
    isDraft: Boolean(pr.draft),
  };
}

// push/workflow_dispatch 컨텍스트에서 태그를 해석하고 "<prefix>/**" 형식으로 검증한다.
function resolveTagRefOrThrow({ context, core, prefix }) {
  const isManual = context.eventName === 'workflow_dispatch';
  const refName = isManual
    ? (core.getInput('tag') || '').trim()
    : context.ref.replace('refs/tags/', '');

  const pattern = new RegExp(`^${prefix}/.+`);
  if (!pattern.test(refName)) {
    throw new Error(`유효하지 않은 태그 형식입니다: '${refName}'. '${prefix}/**' 형식이어야 합니다.`);
  }

  return refName;
}

// qa 태그("qa/x_y")를 버전 형식("x-y")으로 변환한다.
function parseQaVersion(tagRef) {
  return tagRef.replace(/^qa\//, '').replace(/_/g, '-');
}

// release 태그에서 버전 문자열을 추출한다("release/x" -> "x").
function parseReleaseVersion(tagRef) {
  return tagRef.replace(/^release\//, '');
}

module.exports = {
  parseIssueContext,
  parsePullRequestContext,
  resolveTagRefOrThrow,
  parseQaVersion,
  parseReleaseVersion,
};
