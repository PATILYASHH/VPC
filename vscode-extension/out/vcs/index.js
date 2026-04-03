"use strict";
/**
 * VPC VCS Staging Area (Index)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readIndex = readIndex;
exports.writeIndex = writeIndex;
exports.stageFile = stageFile;
exports.unstageFile = unstageFile;
exports.stageAllFiles = stageAllFiles;
exports.buildIndexFromTree = buildIndexFromTree;
exports.isFileModified = isFileModified;
exports.getAllWorkspaceFiles = getAllWorkspaceFiles;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const objects_1 = require("./objects");
function indexPath(root) {
    return path.join((0, objects_1.vpcDir)(root), 'index');
}
function readIndex(root) {
    const idxPath = indexPath(root);
    if (!fs.existsSync(idxPath)) {
        return { entries: [] };
    }
    try {
        return JSON.parse(fs.readFileSync(idxPath, 'utf8'));
    }
    catch {
        return { entries: [] };
    }
}
function writeIndex(root, index) {
    fs.writeFileSync(indexPath(root), JSON.stringify(index, null, 2));
}
function stageFile(root, filePath) {
    const absPath = path.resolve(root, filePath);
    const index = readIndex(root);
    if (!fs.existsSync(absPath)) {
        // File deleted — remove from index
        index.entries = index.entries.filter(e => e.path !== filePath);
        writeIndex(root, index);
        return null;
    }
    const content = fs.readFileSync(absPath);
    const hash = (0, objects_1.createBlob)(root, content);
    const stat = fs.statSync(absPath);
    const mode = stat.mode & 0o111 ? '100755' : '100644';
    const entry = { path: filePath, hash, mode, size: stat.size, mtime: stat.mtimeMs };
    const existing = index.entries.findIndex(e => e.path === filePath);
    if (existing >= 0) {
        index.entries[existing] = entry;
    }
    else {
        index.entries.push(entry);
    }
    index.entries.sort((a, b) => a.path.localeCompare(b.path));
    writeIndex(root, index);
    return hash;
}
function unstageFile(root, filePath) {
    const index = readIndex(root);
    index.entries = index.entries.filter(e => e.path !== filePath);
    writeIndex(root, index);
}
function stageAllFiles(root) {
    const allFiles = getAllWorkspaceFiles(root);
    const index = readIndex(root);
    const indexMap = new Map(index.entries.map(e => [e.path, e.hash]));
    let staged = 0;
    for (const filePath of allFiles) {
        const absPath = path.resolve(root, filePath);
        const content = fs.readFileSync(absPath);
        const hash = (0, objects_1.hashObject)('blob', content);
        // Only stage if changed from index
        if (indexMap.get(filePath) !== hash) {
            stageFile(root, filePath);
            staged++;
        }
    }
    // Handle deleted files (in index but not on disk)
    for (const entry of index.entries) {
        if (!fs.existsSync(path.resolve(root, entry.path))) {
            stageFile(root, entry.path); // removes from index
            staged++;
        }
    }
    return staged;
}
function buildIndexFromTree(root, treeHash) {
    const manifest = (0, objects_1.walkTree)(root, treeHash);
    const index = {
        entries: manifest.map(f => ({
            path: f.path, hash: f.hash, mode: f.mode || '100644', size: 0, mtime: Date.now(),
        })),
    };
    writeIndex(root, index);
}
function isFileModified(root, filePath) {
    const absPath = path.resolve(root, filePath);
    if (!fs.existsSync(absPath)) {
        return true;
    }
    const content = fs.readFileSync(absPath);
    const currentHash = (0, objects_1.hashObject)('blob', content);
    const index = readIndex(root);
    const entry = index.entries.find(e => e.path === filePath);
    if (!entry) {
        return true;
    }
    return entry.hash !== currentHash;
}
const DEFAULT_IGNORE = ['.vpc', 'node_modules', '.git', '.DS_Store', '.env', '.env.local',
    'dist', 'out', 'build', '.vscode', '__pycache__', '.next', '.nuxt', '.cache',
    '.idea', '.gradle', 'vendor', '.dart_tool', '.pub-cache', 'target', 'obj', '.angular',
    'Thumbs.db', '*.pyc', '.sass-cache', 'coverage'];
function loadIgnorePatterns(root) {
    const patterns = new Set(DEFAULT_IGNORE);
    // Load .vpcignore if it exists
    const ignorePath = path.join(root, '.vpcignore');
    if (fs.existsSync(ignorePath)) {
        try {
            const lines = fs.readFileSync(ignorePath, 'utf8').split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    patterns.add(trimmed);
                }
            }
        }
        catch { /* ignore read errors */ }
    }
    return patterns;
}
function shouldIgnore(name, ignorePatterns) {
    if (ignorePatterns.has(name)) {
        return true;
    }
    // Check wildcard patterns like *.pyc
    for (const pattern of ignorePatterns) {
        if (pattern.startsWith('*.') && name.endsWith(pattern.slice(1))) {
            return true;
        }
    }
    return false;
}
function getAllWorkspaceFiles(root) {
    const ignorePatterns = loadIgnorePatterns(root);
    const results = [];
    function walk(dir) {
        try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (shouldIgnore(entry.name, ignorePatterns)) {
                    continue;
                }
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                }
                else if (entry.isFile()) {
                    const rel = path.relative(root, fullPath).replace(/\\/g, '/');
                    results.push(rel);
                }
            }
        }
        catch { /* skip unreadable */ }
    }
    walk(root);
    return results;
}
//# sourceMappingURL=index.js.map