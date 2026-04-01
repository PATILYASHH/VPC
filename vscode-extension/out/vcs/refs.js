"use strict";
/**
 * VPC VCS Ref Management
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
exports.readHead = readHead;
exports.writeHead = writeHead;
exports.getCurrentBranch = getCurrentBranch;
exports.resolveRef = resolveRef;
exports.updateRef = updateRef;
exports.deleteRef = deleteRef;
exports.listBranches = listBranches;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const objects_1 = require("./objects");
function readHead(root) {
    const headPath = path.join((0, objects_1.vpcDir)(root), 'HEAD');
    if (!fs.existsSync(headPath)) {
        return { symbolic: true, ref: 'refs/heads/main' };
    }
    const content = fs.readFileSync(headPath, 'utf8').trim();
    if (content.startsWith('ref: ')) {
        return { symbolic: true, ref: content.slice(5) };
    }
    return { symbolic: false, hash: content };
}
function writeHead(root, value) {
    const headPath = path.join((0, objects_1.vpcDir)(root), 'HEAD');
    if (value.startsWith('refs/')) {
        fs.writeFileSync(headPath, `ref: ${value}\n`);
    }
    else {
        fs.writeFileSync(headPath, `${value}\n`);
    }
}
function getCurrentBranch(root) {
    const head = readHead(root);
    if (head.symbolic && head.ref) {
        return head.ref.replace('refs/heads/', '');
    }
    return null;
}
function resolveRef(root, ref) {
    const vpc = (0, objects_1.vpcDir)(root);
    if (!ref) {
        return null;
    }
    if (/^[a-f0-9]{64}$/.test(ref)) {
        return ref;
    }
    if (ref === 'HEAD') {
        const head = readHead(root);
        if (head.symbolic && head.ref) {
            return resolveRef(root, head.ref);
        }
        return head.hash || null;
    }
    // Full ref path
    const fullPath = path.join(vpc, ref);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return fs.readFileSync(fullPath, 'utf8').trim();
    }
    // Branch name
    const branchPath = path.join(vpc, 'refs', 'heads', ref);
    if (fs.existsSync(branchPath)) {
        return fs.readFileSync(branchPath, 'utf8').trim();
    }
    // Remote tracking
    const remotePath = path.join(vpc, 'refs', 'remotes', 'origin', ref);
    if (fs.existsSync(remotePath)) {
        return fs.readFileSync(remotePath, 'utf8').trim();
    }
    // Tag
    const tagPath = path.join(vpc, 'refs', 'tags', ref);
    if (fs.existsSync(tagPath)) {
        return fs.readFileSync(tagPath, 'utf8').trim();
    }
    return null;
}
function updateRef(root, refName, hash) {
    const refPath = path.join((0, objects_1.vpcDir)(root), refName);
    const dir = path.dirname(refPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(refPath, hash + '\n');
}
function deleteRef(root, refName) {
    const refPath = path.join((0, objects_1.vpcDir)(root), refName);
    if (fs.existsSync(refPath)) {
        fs.unlinkSync(refPath);
    }
}
function listBranches(root) {
    const branches = [];
    const baseDir = path.join((0, objects_1.vpcDir)(root), 'refs', 'heads');
    if (!fs.existsSync(baseDir)) {
        return branches;
    }
    function walk(dir, prefix) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            const refName = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walk(fullPath, refName);
            }
            else {
                const hash = fs.readFileSync(fullPath, 'utf8').trim();
                branches.push({ name: refName, hash });
            }
        }
    }
    walk(baseDir, '');
    return branches;
}
//# sourceMappingURL=refs.js.map