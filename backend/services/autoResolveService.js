/**
 * Auto-Resolve Service
 *
 * Handles background AI conflict resolution after a force-push.
 * When a push has conflicts, this service:
 * 1. Uses AI to resolve each conflicted file
 * 2. Creates a follow-up "resolution" commit on the branch
 * 3. Creates an issue/notification with details of what was resolved
 */

const vcsCore = require('./vpcVcsCore');
const aiReviewService = require('./aiReviewService');

/**
 * Resolve conflicts in background after a force-push.
 * This is fire-and-forget — errors are logged, never thrown to user.
 */
async function resolveInBackground(pool, {
  repoId, repoPath, owner, slug, branchName, refName,
  mergeCommitHash, conflicts, username, authorId,
}) {
  try {
    console.log(`[Auto-Resolve] Starting for ${owner}/${slug}:${branchName} — ${conflicts.length} conflict(s)`);

    const resolvedFiles = [];
    const failedFiles = [];

    for (const conflict of conflicts) {
      try {
        // Skip binary conflicts — AI can't resolve those
        if (conflict.type === 'binary') {
          failedFiles.push({ path: conflict.path, reason: 'Binary file — cannot auto-resolve' });
          continue;
        }

        // Skip delete-modify conflicts — keep existing
        if (conflict.type === 'delete-modify' || conflict.type === 'modify-delete') {
          failedFiles.push({ path: conflict.path, reason: 'One side deleted, other modified — kept existing version' });
          continue;
        }

        // Get the conflicted content (has conflict markers)
        const conflictedContent = conflict.content;
        if (!conflictedContent || !conflictedContent.includes('<<<<<<<')) {
          continue; // No actual conflict markers
        }

        // Ask AI to resolve
        const result = await aiReviewService.resolveConflicts(conflictedContent, conflict.path, { pool });

        if (!result || !result.available) {
          failedFiles.push({ path: conflict.path, reason: 'AI service not available' });
          continue;
        }

        // Parse AI response
        let resolution;
        try {
          const text = result.response || result;
          resolution = typeof text === 'string' ? JSON.parse(text) : text;
        } catch {
          failedFiles.push({ path: conflict.path, reason: 'AI returned invalid response' });
          continue;
        }

        if (!resolution.resolved_content) {
          failedFiles.push({ path: conflict.path, reason: 'AI could not resolve' });
          continue;
        }

        resolvedFiles.push({
          path: conflict.path,
          content: resolution.resolved_content,
          confidence: resolution.confidence || 'medium',
          strategy: resolution.strategy || 'AI merged both sides',
          summary: resolution.plain_summary || 'AI resolved the conflict automatically',
        });

      } catch (err) {
        console.error(`[Auto-Resolve] Error resolving ${conflict.path}:`, err.message);
        failedFiles.push({ path: conflict.path, reason: err.message });
      }
    }

    // If we resolved any files, create a follow-up commit
    if (resolvedFiles.length > 0) {
      // Read current commit tree
      const currentCommit = vcsCore.readCommit(repoPath, mergeCommitHash);
      const currentFiles = vcsCore.walkTree(repoPath, currentCommit.tree);

      // Build new file list with resolved content replacing conflicted files
      const updatedFiles = [];
      const resolvedMap = new Map(resolvedFiles.map(f => [f.path, f]));

      for (const file of currentFiles) {
        if (resolvedMap.has(file.path)) {
          // Replace with resolved content
          const resolved = resolvedMap.get(file.path);
          const newHash = vcsCore.createBlob(repoPath, resolved.content);
          updatedFiles.push({ path: file.path, hash: newHash, mode: file.mode || '100644' });
        } else {
          updatedFiles.push({ path: file.path, hash: file.hash, mode: file.mode || '100644' });
        }
      }

      // Build new tree and commit
      const newTreeHash = vcsCore.buildTreeFromFiles(repoPath, updatedFiles);
      const resolutionMessage = resolvedFiles.map(f =>
        `  - ${f.path}: ${f.summary} (${f.confidence} confidence)`
      ).join('\n');

      const resolveCommitHash = vcsCore.createCommit(repoPath, {
        tree: newTreeHash,
        parents: [mergeCommitHash],
        authorName: 'VPAI',
        authorEmail: 'vpai@vpshub',
        message: `Auto-resolve: AI fixed ${resolvedFiles.length} conflict(s)\n\n${resolutionMessage}`,
      });

      // Update the branch ref
      vcsCore.updateRef(repoPath, refName, resolveCommitHash);

      // Sync to DB
      try { await vcsCore.syncRefsToDb(pool, repoId, repoPath); } catch { /* ignore */ }
      try { await vcsCore.syncCommitsToDb(pool, repoId, repoPath, resolveCommitHash); } catch { /* ignore */ }

      console.log(`[Auto-Resolve] Success! Created resolution commit ${resolveCommitHash.slice(0, 12)} for ${owner}/${slug}`);
    }

    // Create an issue if there were any conflicts (resolved or not)
    try {
      const issueService = require('./vpshubIssueService');

      const resolvedList = resolvedFiles.length > 0
        ? `**AI Resolved (${resolvedFiles.length}):**\n${resolvedFiles.map(f => `- \`${f.path}\` — ${f.summary} _(${f.confidence})_`).join('\n')}\n\n`
        : '';

      const failedList = failedFiles.length > 0
        ? `**Needs Manual Review (${failedFiles.length}):**\n${failedFiles.map(f => `- \`${f.path}\` — ${f.reason}`).join('\n')}\n\n`
        : '';

      const statusEmoji = failedFiles.length === 0 ? 'All conflicts resolved' : 'Some conflicts need attention';

      await issueService.createIssue(pool, {
        repoId,
        title: `Push conflict auto-resolved: ${statusEmoji}`,
        body: `A push by **${username}** to \`${branchName}\` had merge conflicts.\n\n${resolvedList}${failedList}${
          resolvedFiles.length > 0
            ? '_AI created a resolution commit automatically. Review the changes to make sure they look correct._'
            : '_No files could be auto-resolved. Please resolve these conflicts manually._'
        }`,
        authorId,
        labels: ['auto-resolve', failedFiles.length === 0 ? 'resolved' : 'needs-review'],
      });
    } catch (err) {
      console.error('[Auto-Resolve] Failed to create issue:', err.message);
    }

  } catch (err) {
    console.error('[Auto-Resolve] Fatal error:', err.message, err.stack);
  }
}

module.exports = { resolveInBackground };
