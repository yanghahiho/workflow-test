// 스킵 가능한 잡의 기본 output 값을 일괄 초기화한다.
function initSkipOutputs({ core, outputs }) {
  for (const [key, value] of Object.entries(outputs || {})) {
    core.setOutput(key, String(value));
  }
}

// needs output 문자열을 JSON으로 파싱하고 실패 시 명시적 예외를 던진다.
function readNeedsJsonOrThrow({ raw, label }) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} JSON 파싱 실패: ${error.message}`);
  }
}

// 실패 건수가 1건 이상이면 워크플로우를 실패로 종료한다.
function failIfAny({ failedCount, label }) {
  if (Number(failedCount) > 0) {
    throw new Error(`${label} 실패가 ${failedCount}건 발생했습니다.`);
  }
}

// repository/organization variables에서 전달된 프로젝트 번호 문자열을 정수로 파싱한다.
function parseProjectNumberOrNull(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) {
    throw new Error(`PROJECT_NO 값이 숫자가 아닙니다: '${value}'`);
  }
  return Number(value);
}

module.exports = {
  initSkipOutputs,
  readNeedsJsonOrThrow,
  failIfAny,
  parseProjectNumberOrNull,
};
