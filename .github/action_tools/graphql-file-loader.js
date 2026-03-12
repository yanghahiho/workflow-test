const fs = require('fs');

const queryCache = new Map();

// GraphQL 파일을 캐시 기반으로 로드한다.
function loadQuery(filePath) {
  if (!queryCache.has(filePath)) {
    queryCache.set(filePath, fs.readFileSync(filePath, 'utf8'));
  }
  return queryCache.get(filePath);
}

// operationName을 고정해 다중 operation 파일에서도 안전하게 실행한다.
async function runGraphql({ github, filePath, operationName, variables = {} }) {
  const query = loadQuery(filePath);
  const graphqlClient = operationName ? github.graphql.defaults({ operationName }) : github.graphql;
  return graphqlClient(query, variables);
}

module.exports = {
  loadQuery,
  runGraphql,
};
