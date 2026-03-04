function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(query.pageSize) || 50));
  const offset = (page - 1) * pageSize;

  return { page, pageSize, offset };
}

module.exports = { parsePagination };
