// REST/GraphQL 오류 형태를 액션 로그용 표준 원인 라벨로 분류한다.
function classifyError(error) {
  const message = error?.message || "";
  const status = error?.status || error?.response?.status;
  if (status === 404 || message.includes("Not Found")) return "Not Found";
  if (status === 403 || message.includes("Forbidden")) return "Forbidden";
  if (status === 422 || message.includes("Validation failed")) return "Validation failed";
  return "Unknown";
}

// GitHub Actions 트러블슈팅을 위해 구조화된 오류 정보를 한 줄 로그로 출력한다.
function logDetailedError({ error, label, issueNumber, logger = console }) {
  const status = error?.status || error?.response?.status || "N/A";
  const graphQLErrors = error?.errors || error?.graphQLErrors || error?.response?.data?.errors || [];
  const pathInfo = graphQLErrors?.[0]?.path || error?.path || null;
  logger.log(
    `[${label}] 원인:${classifyError(error)} status:${status} issue:${issueNumber ?? "N/A"} path:${JSON.stringify(pathInfo)} graphQLErrors:${JSON.stringify(graphQLErrors)} message:${error?.message || ""}`
  );
}

module.exports = {
  classifyError,
  logDetailedError,
};
