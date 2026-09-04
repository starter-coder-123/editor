/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The asset library's view of a project folder on desktop: the main process
// reads and writes the manifest (as YAML) and lists and stats files; bytes
// come in as real Files (see ElectronFileHandle) and go out through the
// streaming FILE_WRITE_* channels.

import { MAIN_CHANNELS } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';
import { ElectronFileHandle } from '@/lib/electron-file-handle';
import { ElectronWritableFileHandle } from '@/lib/electron-file-writable';
import { isAbsoluteSource } from '@diffusionstudio/assets';

import type { Manifest, ProjectFS } from '@diffusionstudio/assets';

/** Streams `blob` to an absolute path in chunks. */
async function writeBlob(path: string, blob: Blob): Promise<void> {
	const target = new ElectronWritableFileHandle(path);
	const writable = await target.createWritable();
	const writer = writable.getWriter();
	try {
		let position = 0;
		const reader = blob.stream().getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			await writer.write({ type: 'write', data: value, position });
			position += value.byteLength;
		}
		await writer.close();
	} catch (error) {
		await writer.abort().catch(() => {});
		throw error;
	}
}

/** The `ProjectFS` of the project folder at `dir`. */
export function createProjectFS(dir: string): ProjectFS {
	const separator = dir.includes('\\') ? '\\' : '/';
	const absolute = (source: string): string =>
		isAbsoluteSource(source) ? source : `${dir}${separator}${source.split('/').join(separator)}`;

	if (!window.desktop) {
		const segments = dir.replace(/\\/g, '/').split('/');
		const id = segments[segments.length - 1] || dir;
		const API_BASE = "";

		return {
			absolute,
			readManifest: async () => {
				try {
					const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}/manifest`);
					if (!res.ok) return { name: dir, assets: [] };
					return await res.json();
				} catch {
					return { name: dir, assets: [] };
				}
			},
			writeManifest: async (manifest: Manifest) => {
				try {
					await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}/manifest`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(manifest),
					});
				} catch {
					// optional
				}
			},
			list: async (source: string) => {
				try {
					const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}/fs/list?source=${encodeURIComponent(source)}`);
					if (!res.ok) return [];
					return await res.json();
				} catch {
					return [];
				}
			},
			stat: async (source: string) => {
				try {
					const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}/fs/stat?source=${encodeURIComponent(source)}`);
					if (!res.ok) return null;
					return await res.json();
				} catch {
					return null;
				}
			},
			file: async (source: string) => {
				const clean = source.replace(/^[/\\]+/, '');
				// Use /fs/file endpoint with application/octet-stream and X-Requested-With to prevent IDM / download managers from intercepting
				let res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}/fs/file?source=${encodeURIComponent(clean)}`, {
					headers: {
						'X-Requested-With': 'XMLHttpRequest',
						'Accept': 'application/octet-stream',
					},
				});
				if (!res.ok) {
					res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}/assets/${clean}`, {
						headers: { 'X-Requested-With': 'XMLHttpRequest' },
					});
				}
				if (!res.ok) throw new Error(`Could not fetch asset: ${source}`);
				const blob = await res.blob();
				const filename = clean.split('/').pop() || 'asset';
				let mime = blob.type;
				if (!mime || mime === 'application/octet-stream') {
					if (filename.endsWith('.png')) mime = 'image/png';
					else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) mime = 'image/jpeg';
					else if (filename.endsWith('.wav')) mime = 'audio/wav';
					else if (filename.endsWith('.mp3')) mime = 'audio/mpeg';
					else if (filename.endsWith('.mp4')) mime = 'video/mp4';
				}
				return new File([blob], filename, { type: mime });
			},
			write: () => Promise.resolve(),
			remove: () => Promise.resolve(),
			realPath: () => Promise.resolve(null),
			pathOf: () => null,
		};
	}

	return {
		absolute,
		readManifest: () => mainBridge.call(MAIN_CHANNELS.PROJECTS_MANIFEST_READ, { dir }),
		writeManifest: (manifest: Manifest) => mainBridge.call(MAIN_CHANNELS.PROJECTS_MANIFEST_WRITE, { dir, manifest }),
		list: (source) => mainBridge.call(MAIN_CHANNELS.PROJECTS_FS_LIST, { dir, source }),
		stat: (source) => mainBridge.call(MAIN_CHANNELS.PROJECTS_FS_STAT, { dir, source }),
		file: (source) => new ElectronFileHandle(absolute(source)).getFile(),
		write: (path, blob) => writeBlob(absolute(path), blob),
		remove: (path) => mainBridge.call(MAIN_CHANNELS.PROJECTS_FS_REMOVE, { dir, path }),
		realPath: (source) => mainBridge.call(MAIN_CHANNELS.PROJECTS_FS_REAL_PATH, { dir, source }),
		pathOf: (file) => window.desktop?.getPathForFile(file) || null,
	};
}
