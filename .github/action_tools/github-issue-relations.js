const { runGraphql } = require('./graphql-file-loader');
const { resolveExpectedRepoFullName, assertSameRepoOrThrow } = require('./github-issue-ops');

const GRAPHQL_READ_FILE = '.github/graphql/query-read.graphql';
const GRAPHQL_WRITE_FILE = '.github/graphql/mutation-write.graphql';

// 대상 이슈를 프로젝트에 연결한다. 이미 연결되어 있으면 재사용한다.
async function ensureProjectLinked({ github, context, issueNodeId, projectNumber, org }) {
  const expectedRepo = resolveExpectedRepoFullName({ context });
  const projectData = await runGraphql({
    github,
    filePath: GRAPHQL_READ_FILE,
    operationName: 'GetProjectMeta',
    variables: {
      org,
      number: projectNumber,
    },
  });


  const projectId = projectData?.organization?.projectV2?.id;
  if (!projectId) {
    throw new Error('프로젝트 ID를 찾을 수 없습니다.');
  }

  const itemData = await runGraphql({
    github,
    filePath: GRAPHQL_READ_FILE,
    operationName: 'GetProjectItem',
    variables: { id: issueNodeId },
  });
  const issueRepo = itemData?.node?.repository?.nameWithOwner || null;
  assertSameRepoOrThrow({
    actualRepo: issueRepo,
    expectedRepo,
    label: '프로젝트 연결 대상 이슈',
  });

  const existingItem = itemData?.node?.projectItems?.nodes?.find((node) => node.project.id === projectId);
  if (existingItem) {
    return { projectId, added: false };
  }

  await runGraphql({
    github,
    filePath: GRAPHQL_WRITE_FILE,
    operationName: 'AddProjectItem',
    variables: {
      projectId,
      contentId: issueNodeId,
    },
  });

  return { projectId, added: true };
}

// PR를 레포지토리 프로젝트(번호 기준)에 연결한다. 프로젝트가 없으면 skip 처리한다.
async function ensurePullRequestProjectLinkedByNumber({ github, context, pullRequestNodeId, projectNumber, org }) {
  const expectedRepo = resolveExpectedRepoFullName({ context });
  const projectData = await runGraphql({
    github,
    filePath: GRAPHQL_READ_FILE,
    operationName: 'GetRepoProjectMetaByNumber',
    variables: {
      owner: org,
      number: Number(projectNumber),
    },
  });

  const projectRepo = projectData?.repository?.nameWithOwner || null;
  assertSameRepoOrThrow({
    actualRepo: projectRepo,
    expectedRepo,
    label: '프로젝트 조회 대상 레포',
  });

  const project = projectData?.repository?.projectV2 || null;
  if (!project?.id || project.closed) {
    return { found: false, added: false, skipped: true, reason: 'project_not_found_or_closed' };
  }

  const itemData = await runGraphql({
    github,
    filePath: GRAPHQL_READ_FILE,
    operationName: 'GetPullRequestProjectItem',
    variables: { id: pullRequestNodeId },
  });
  const prRepo = itemData?.node?.repository?.nameWithOwner || null;
  assertSameRepoOrThrow({
    actualRepo: prRepo,
    expectedRepo,
    label: '프로젝트 연결 대상 PR',
  });

  const existingItem = itemData?.node?.projectItems?.nodes?.find((node) => node.project.id === project.id);
  if (existingItem) {
    return { found: true, added: false, skipped: true, reason: 'already_linked', projectId: project.id };
  }

  await runGraphql({
    github,
    filePath: GRAPHQL_WRITE_FILE,
    operationName: 'AddProjectItem',
    variables: {
      projectId: project.id,
      contentId: pullRequestNodeId,
    },
  });

  return { found: true, added: true, skipped: false, projectId: project.id };
}

// PR를 레포지토리에 연결된 첫 open 프로젝트에 연결한다. 프로젝트가 없으면 skip 처리한다.
async function ensurePullRequestProjectLinkedToRepoProject({ github, context, pullRequestNodeId }) {
  const expectedRepo = resolveExpectedRepoFullName({ context });
  const projectData = await runGraphql({
    github,
    filePath: GRAPHQL_READ_FILE,
    operationName: 'GetRepoLinkedProjects',
    variables: {
      owner: context.repo.owner,
      repo: context.repo.repo,
    },
  });

  const projectRepo = projectData?.repository?.nameWithOwner || null;
  assertSameRepoOrThrow({
    actualRepo: projectRepo,
    expectedRepo,
    label: '프로젝트 조회 대상 레포',
  });

  const projects = projectData?.repository?.projectsV2?.nodes || [];
  const targetProject = projects.find((project) => project?.id && !project.closed) || null;
  if (!targetProject) {
    return { found: false, added: false, skipped: true, reason: 'project_not_found_or_closed' };
  }

  const itemData = await runGraphql({
    github,
    filePath: GRAPHQL_READ_FILE,
    operationName: 'GetPullRequestProjectItem',
    variables: { id: pullRequestNodeId },
  });
  const prRepo = itemData?.node?.repository?.nameWithOwner || null;
  assertSameRepoOrThrow({
    actualRepo: prRepo,
    expectedRepo,
    label: '프로젝트 연결 대상 PR',
  });

  const existingItem = itemData?.node?.projectItems?.nodes?.find((node) => node.project.id === targetProject.id);
  if (existingItem) {
    return {
      found: true,
      added: false,
      skipped: true,
      reason: 'already_linked',
      projectId: targetProject.id,
      projectNumber: targetProject.number,
      projectTitle: targetProject.title,
    };
  }

  await runGraphql({
    github,
    filePath: GRAPHQL_WRITE_FILE,
    operationName: 'AddProjectItem',
    variables: {
      projectId: targetProject.id,
      contentId: pullRequestNodeId,
    },
  });

  return {
    found: true,
    added: true,
    skipped: false,
    projectId: targetProject.id,
    projectNumber: targetProject.number,
    projectTitle: targetProject.title,
  };
}

// child를 target 부모에 연결한다. (이미 부모가 있으면 재연결하지 않고 스킵)
async function linkIssueToParent({ github, context, parentNodeId, childNodeId }) {
  const expectedRepo = resolveExpectedRepoFullName({ context });
  const parentData = await runGraphql({
    github,
    filePath: GRAPHQL_READ_FILE,
    operationName: 'GetIssueParent',
    variables: { id: childNodeId },
  });
  const childRepo = parentData?.node?.repository?.nameWithOwner || null;
  assertSameRepoOrThrow({
    actualRepo: childRepo,
    expectedRepo,
    label: '부모 연결 대상 자식 이슈',
  });

  const currentParent = parentData?.node?.parent;
  if (currentParent?.id) {
    assertSameRepoOrThrow({
      actualRepo: currentParent?.repository?.nameWithOwner || null,
      expectedRepo,
      label: '기존 부모 이슈',
    });
  }

  const targetParentData = await runGraphql({
    github,
    filePath: GRAPHQL_READ_FILE,
    operationName: 'GetIssueParent',
    variables: { id: parentNodeId },
  });
  assertSameRepoOrThrow({
    actualRepo: targetParentData?.node?.repository?.nameWithOwner || null,
    expectedRepo,
    label: '연결 대상 부모 이슈',
  });

  if (currentParent?.id === parentNodeId) {
    return { detached: false, linked: false, skipped: true };
  }

  if (currentParent?.id) {
    return { detached: false, linked: false, skipped: true, reason: 'already_has_parent' };
  }

  await runGraphql({
    github,
    filePath: GRAPHQL_WRITE_FILE,
    operationName: 'AddSubIssue',
    variables: {
      issueId: parentNodeId,
      subIssueId: childNodeId,
    },
  });

  return {
    detached: false,
    linked: true,
    skipped: false,
  };
}

// 부모의 직계 하위를 상태 필터로 수집한다. (state 미지정 시 전체 수집)
async function collectDirectChildrenByState({ github, context, parentNodeId, state = null }) {
  const expectedRepo = resolveExpectedRepoFullName({ context });
  const normalizedState = state ? String(state).toUpperCase() : null;
  const children = [];
  let cursor = null;

  while (true) {
    const data = await runGraphql({
      github,
      filePath: GRAPHQL_READ_FILE,
      operationName: 'GetSubIssuesWithStatus',
      variables: { id: parentNodeId, cursor },
    });

    const subIssues = data?.node?.subIssues;
    assertSameRepoOrThrow({
      actualRepo: data?.node?.repository?.nameWithOwner || null,
      expectedRepo,
      label: '하위 수집 대상 부모 이슈',
    });
    const nodes = subIssues?.nodes || [];

    for (const child of nodes) {
      assertSameRepoOrThrow({
        actualRepo: child?.repository?.nameWithOwner || null,
        expectedRepo,
        label: `하위 수집 대상 자식 이슈 #${child?.number || 'unknown'}`,
      });

      const childState = (child.state || 'OPEN').toUpperCase();
      if (normalizedState && childState !== normalizedState) {
        continue;
      }
      children.push({
        id: child.id,
        number: child.number,
        state: childState,
        repository: child?.repository?.nameWithOwner || null,
        parentId: parentNodeId,
      });
    }

    if (!subIssues?.pageInfo?.hasNextPage) {
      break;
    }
    cursor = subIssues.pageInfo.endCursor;
  }

  return children;
}

// 하위 이슈들을 지정 부모로 이동한다. (기존 부모가 있으면 제거 후 연결)
async function moveChildrenToParent({ github, context, children, targetParentNodeId }) {
  const expectedRepo = resolveExpectedRepoFullName({ context });
  let moved = 0;
  let failed = 0;
  let skipped = 0;

  const targetParentData = await runGraphql({
    github,
    filePath: GRAPHQL_READ_FILE,
    operationName: 'GetIssueParent',
    variables: { id: targetParentNodeId },
  });
  assertSameRepoOrThrow({
    actualRepo: targetParentData?.node?.repository?.nameWithOwner || null,
    expectedRepo,
    label: '이동 대상 부모 이슈',
  });

  for (const child of children || []) {
    try {
      const childNodeId = child.id || child.node_id;
      if (!childNodeId) {
        skipped += 1;
        continue;
      }
      if (child?.repository) {
        assertSameRepoOrThrow({
          actualRepo: child.repository,
          expectedRepo,
          label: `이동 입력 자식 이슈 #${child?.number || 'unknown'}`,
        });
      }

      const parentData = await runGraphql({
        github,
        filePath: GRAPHQL_READ_FILE,
        operationName: 'GetIssueParent',
        variables: { id: childNodeId },
      });
      assertSameRepoOrThrow({
        actualRepo: parentData?.node?.repository?.nameWithOwner || null,
        expectedRepo,
        label: `이동 대상 자식 이슈 #${child?.number || 'unknown'}`,
      });
      const currentParent = parentData?.node?.parent;
      if (currentParent?.id) {
        assertSameRepoOrThrow({
          actualRepo: currentParent?.repository?.nameWithOwner || null,
          expectedRepo,
          label: `기존 부모 이슈(자식 #${child?.number || 'unknown'})`,
        });
      }

      if (currentParent?.id === targetParentNodeId) {
        skipped += 1;
        continue;
      }

      if (currentParent?.id) {
        await runGraphql({
          github,
          filePath: GRAPHQL_WRITE_FILE,
          operationName: 'RemoveSubIssue',
          variables: {
            issueId: currentParent.id,
            subIssueId: childNodeId,
          },
        });
      }

      await runGraphql({
        github,
        filePath: GRAPHQL_WRITE_FILE,
        operationName: 'AddSubIssue',
        variables: {
          issueId: targetParentNodeId,
          subIssueId: childNodeId,
        },
      });
      moved += 1;
    } catch (e) {
      if (String(e?.message || '').includes('[REPO_GUARD]')) {
        throw e;
      }
      failed += 1;
    }
  }

  return { moved, failed, skipped };
}

// 입력된 이슈들 중 같은 집합 내부 부모를 가진 항목을 제외하고 최상위만 반환한다.
async function selectTopLevelIssues({ github, context, issueNodeIds }) {
  const expectedRepo = resolveExpectedRepoFullName({ context });
  const nodeIdSet = new Set(issueNodeIds || []);
  const topLevelNodeIds = [];

  for (const nodeId of issueNodeIds || []) {
    const parentData = await runGraphql({
      github,
      filePath: GRAPHQL_READ_FILE,
      operationName: 'GetIssueParent',
      variables: { id: nodeId },
    });
    assertSameRepoOrThrow({
      actualRepo: parentData?.node?.repository?.nameWithOwner || null,
      expectedRepo,
      label: '최상위 선별 대상 이슈',
    });

    const parentId = parentData?.node?.parent?.id || null;
    if (parentData?.node?.parent?.id) {
      assertSameRepoOrThrow({
        actualRepo: parentData?.node?.parent?.repository?.nameWithOwner || null,
        expectedRepo,
        label: '최상위 선별 중 부모 이슈',
      });
    }
    if (!parentId || !nodeIdSet.has(parentId)) {
      topLevelNodeIds.push(nodeId);
    }
  }

  return topLevelNodeIds;
}

module.exports = {
  ensureProjectLinked,
  ensurePullRequestProjectLinkedByNumber,
  ensurePullRequestProjectLinkedToRepoProject,
  linkIssueToParent,
  collectDirectChildrenByState,
  moveChildrenToParent,
  selectTopLevelIssues,
};
