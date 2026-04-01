/**
 * VPC VCS Ref Management
 */

import * as fs from 'fs';
import * as path from 'path';
import { vpcDir, objectExists } from './objects';

export interface HeadRef {
  symbolic: boolean;
  ref?: string;
  hash?: string;
}

export function readHead(root: string): HeadRef {
  const headPath = path.join(vpcDir(root), 'HEAD');
  if (!fs.existsSync(headPath)) { return { symbolic: true, ref: 'refs/heads/main' }; }
  const content = fs.readFileSync(headPath, 'utf8').trim();
  if (content.startsWith('ref: ')) { return { symbolic: true, ref: content.slice(5) }; }
  return { symbolic: false, hash: content };
}

export function writeHead(root: string, value: string): void {
  const headPath = path.join(vpcDir(root), 'HEAD');
  if (value.startsWith('refs/')) {
    fs.writeFileSync(headPath, `ref: ${value}\n`);
  } else {
    fs.writeFileSync(headPath, `${value}\n`);
  }
}

export function getCurrentBranch(root: string): string | null {
  const head = readHead(root);
  if (head.symbolic && head.ref) { return head.ref.replace('refs/heads/', ''); }
  return null;
}

export function resolveRef(root: string, ref: string): string | null {
  const vpc = vpcDir(root);
  if (!ref) { return null; }
  if (/^[a-f0-9]{64}$/.test(ref)) { return ref; }

  if (ref === 'HEAD') {
    const head = readHead(root);
    if (head.symbolic && head.ref) { return resolveRef(root, head.ref); }
    return head.hash || null;
  }

  // Full ref path
  const fullPath = path.join(vpc, ref);
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    return fs.readFileSync(fullPath, 'utf8').trim();
  }

  // Branch name
  const branchPath = path.join(vpc, 'refs', 'heads', ref);
  if (fs.existsSync(branchPath)) { return fs.readFileSync(branchPath, 'utf8').trim(); }

  // Remote tracking
  const remotePath = path.join(vpc, 'refs', 'remotes', 'origin', ref);
  if (fs.existsSync(remotePath)) { return fs.readFileSync(remotePath, 'utf8').trim(); }

  // Tag
  const tagPath = path.join(vpc, 'refs', 'tags', ref);
  if (fs.existsSync(tagPath)) { return fs.readFileSync(tagPath, 'utf8').trim(); }

  return null;
}

export function updateRef(root: string, refName: string, hash: string): void {
  const refPath = path.join(vpcDir(root), refName);
  const dir = path.dirname(refPath);
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  fs.writeFileSync(refPath, hash + '\n');
}

export function deleteRef(root: string, refName: string): void {
  const refPath = path.join(vpcDir(root), refName);
  if (fs.existsSync(refPath)) { fs.unlinkSync(refPath); }
}

export function listBranches(root: string): { name: string; hash: string }[] {
  const branches: { name: string; hash: string }[] = [];
  const baseDir = path.join(vpcDir(root), 'refs', 'heads');
  if (!fs.existsSync(baseDir)) { return branches; }

  function walk(dir: string, prefix: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const refName = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(fullPath, refName); }
      else {
        const hash = fs.readFileSync(fullPath, 'utf8').trim();
        branches.push({ name: refName, hash });
      }
    }
  }
  walk(baseDir, '');
  return branches;
}
