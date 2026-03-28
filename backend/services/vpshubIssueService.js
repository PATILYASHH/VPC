// ─── Issue CRUD ───────────────────────────────────────────────

async function getNextIssueNumber(pool, repoId) {
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(issue_number), 0) + 1 as next FROM vpshub_issues WHERE repo_id = $1',
    [repoId]
  );
  return rows[0].next;
}

async function createIssue(pool, { repoId, title, body, authorId, labels }) {
  const issueNumber = await getNextIssueNumber(pool, repoId);

  const { rows } = await pool.query(
    `INSERT INTO vpshub_issues (repo_id, issue_number, title, body, author_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [repoId, issueNumber, title, body || '', authorId]
  );

  const issue = rows[0];

  // Attach labels if provided
  if (labels && labels.length > 0) {
    for (const labelId of labels) {
      await pool.query(
        'INSERT INTO vpshub_issue_labels (issue_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [issue.id, labelId]
      );
    }
  }

  return issue;
}

async function listIssues(pool, repoId, { status, label, limit = 30, offset = 0 } = {}) {
  let query = `
    SELECT i.*, a.username as author_username, a.display_name as author_display_name,
           c.username as closed_by_username
    FROM vpshub_issues i
    JOIN vpc_admins a ON a.id = i.author_id
    LEFT JOIN vpc_admins c ON c.id = i.closed_by
    WHERE i.repo_id = $1`;
  const params = [repoId];

  if (status && status !== 'all') {
    params.push(status);
    query += ` AND i.status = $${params.length}`;
  }

  if (label) {
    params.push(label);
    query += ` AND EXISTS (
      SELECT 1 FROM vpshub_issue_labels il
      JOIN vpshub_labels l ON l.id = il.label_id
      WHERE il.issue_id = i.id AND l.name = $${params.length}
    )`;
  }

  query += ` ORDER BY i.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const { rows } = await pool.query(query, params);

  // Attach labels and comment counts
  for (const issue of rows) {
    const labelResult = await pool.query(
      `SELECT l.* FROM vpshub_labels l
       JOIN vpshub_issue_labels il ON il.label_id = l.id
       WHERE il.issue_id = $1`,
      [issue.id]
    );
    issue.labels = labelResult.rows;

    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM vpshub_comments WHERE issue_id = $1', [issue.id]
    );
    issue.comment_count = parseInt(countResult.rows[0].count);
  }

  return rows;
}

async function getIssue(pool, repoId, issueNumber) {
  const { rows } = await pool.query(
    `SELECT i.*, a.username as author_username, a.display_name as author_display_name,
            c.username as closed_by_username
     FROM vpshub_issues i
     JOIN vpc_admins a ON a.id = i.author_id
     LEFT JOIN vpc_admins c ON c.id = i.closed_by
     WHERE i.repo_id = $1 AND i.issue_number = $2`,
    [repoId, issueNumber]
  );

  if (!rows[0]) return null;

  const issue = rows[0];

  // Attach labels
  const labelResult = await pool.query(
    `SELECT l.* FROM vpshub_labels l
     JOIN vpshub_issue_labels il ON il.label_id = l.id
     WHERE il.issue_id = $1`,
    [issue.id]
  );
  issue.labels = labelResult.rows;

  return issue;
}

async function getIssueCount(pool, repoId, status) {
  let query = 'SELECT COUNT(*) as count FROM vpshub_issues WHERE repo_id = $1';
  const params = [repoId];
  if (status && status !== 'all') {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }
  const { rows } = await pool.query(query, params);
  return parseInt(rows[0].count);
}

async function updateIssue(pool, issueId, updates) {
  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (['title', 'body', 'status'].includes(key)) {
      fields.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }

  if (fields.length === 0) return null;
  fields.push('updated_at = NOW()');
  values.push(issueId);

  const { rows } = await pool.query(
    `UPDATE vpshub_issues SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0];
}

async function closeIssue(pool, issueId, closedById) {
  const { rows } = await pool.query(
    `UPDATE vpshub_issues SET status = 'closed', closed_by = $1, closed_at = NOW(), updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [closedById, issueId]
  );
  return rows[0];
}

async function reopenIssue(pool, issueId) {
  const { rows } = await pool.query(
    `UPDATE vpshub_issues SET status = 'open', closed_by = NULL, closed_at = NULL, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [issueId]
  );
  return rows[0];
}

// ─── Labels ───────────────────────────────────────────────────

async function createLabel(pool, repoId, { name, color, description }) {
  const { rows } = await pool.query(
    `INSERT INTO vpshub_labels (repo_id, name, color, description)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [repoId, name, color || '#6b7280', description || '']
  );
  return rows[0];
}

async function listLabels(pool, repoId) {
  const { rows } = await pool.query(
    'SELECT * FROM vpshub_labels WHERE repo_id = $1 ORDER BY name',
    [repoId]
  );
  return rows;
}

async function deleteLabel(pool, labelId, repoId) {
  const { rowCount } = await pool.query(
    'DELETE FROM vpshub_labels WHERE id = $1 AND repo_id = $2',
    [labelId, repoId]
  );
  return rowCount > 0;
}

// ─── Activity ─────────────────────────────────────────────────

async function logActivity(pool, { repoId, actorId, action, refType, refId, refNumber, metadata }) {
  await pool.query(
    `INSERT INTO vpshub_activity (repo_id, actor_id, action, ref_type, ref_id, ref_number, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [repoId, actorId, action, refType || null, refId || null, refNumber || null, JSON.stringify(metadata || {})]
  );
}

async function getActivity(pool, repoId, { limit = 30, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT act.*, a.username as actor_username, a.display_name as actor_display_name
     FROM vpshub_activity act
     JOIN vpc_admins a ON a.id = act.actor_id
     WHERE act.repo_id = $1
     ORDER BY act.created_at DESC
     LIMIT $2 OFFSET $3`,
    [repoId, limit, offset]
  );
  return rows;
}

module.exports = {
  createIssue,
  listIssues,
  getIssue,
  getIssueCount,
  updateIssue,
  closeIssue,
  reopenIssue,
  createLabel,
  listLabels,
  deleteLabel,
  logActivity,
  getActivity,
};
