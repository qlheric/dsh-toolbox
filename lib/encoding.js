/**
 * encoding —— 编码 / 解码 / 哈希 / UUID（只依赖 node:crypto）。
 *
 * action:
 *   encode  codec=base64|base64url|url|hex
 *   decode  同上（url 为 decodeURIComponent）
 *   hash    algo=md5|sha1|sha256|sha512，out=hex|base64
 *   uuid    生成 N 个 v4 UUID（N ≤ 100）
 */

import { createHash, randomUUID } from 'node:crypto'

const CODECS = new Set(['base64', 'base64url', 'url', 'hex'])
const ALGOS = new Set(['md5', 'sha1', 'sha256', 'sha512'])

function requireString(value, field) {
  if (typeof value !== 'string' || value === '') throw new Error(`${field} 必须是非空字符串`)
  return value
}

export function encodeText(text, codec) {
  switch (codec) {
    case 'base64':
      return Buffer.from(text, 'utf8').toString('base64')
    case 'base64url':
      return Buffer.from(text, 'utf8').toString('base64url')
    case 'url':
      return encodeURIComponent(text)
    case 'hex':
      return Buffer.from(text, 'utf8').toString('hex')
    default:
      throw new Error(`不支持的 codec "${codec}"（可用 base64/base64url/url/hex）`)
  }
}

export function decodeText(text, codec) {
  switch (codec) {
    case 'base64': {
      const normalized = text.replace(/\s+/g, '')
      return Buffer.from(normalized, 'base64').toString('utf8')
    }
    case 'base64url':
      return Buffer.from(text.replace(/\s+/g, ''), 'base64url').toString('utf8')
    case 'url':
      return decodeURIComponent(text)
    case 'hex': {
      const normalized = text.replace(/\s+/g, '')
      if (normalized.length % 2 !== 0) throw new Error('hex 长度必须是偶数')
      if (!/^[0-9a-fA-F]*$/.test(normalized)) throw new Error('hex 只允许 0-9a-f')
      return Buffer.from(normalized, 'hex').toString('utf8')
    }
    default:
      throw new Error(`不支持的 codec "${codec}"（可用 base64/base64url/url/hex）`)
  }
}

export function hashText(text, algo, out = 'hex') {
  if (!ALGOS.has(algo)) throw new Error(`不支持的 algo "${algo}"（可用 md5/sha1/sha256/sha512）`)
  if (out !== 'hex' && out !== 'base64') throw new Error(`不支持的 out "${out}"（可用 hex/base64）`)
  return createHash(algo).update(text, 'utf8').digest(out)
}

export const spec = {
  name: 'encoding',
  description:
    '编码、解码、哈希与 UUID：base64 / base64url / url / hex 互转；md5 / sha1 / sha256 / sha512 摘要（hex 或 base64）；' +
    '生成 v4 UUID。全部纯本地确定性运算，不发网络请求。',
  parameters: {
    action: {
      type: 'string',
      enum: ['encode', 'decode', 'hash', 'uuid'],
      required: true,
      description: 'encode/decode 需 codec；hash 需 algo；uuid 可指定 count',
    },
    input: { type: 'string', description: 'encode/decode/hash 的输入文本（uuid 不需要）' },
    codec: {
      type: 'string',
      enum: ['base64', 'base64url', 'url', 'hex'],
      description: 'encode/decode 使用的编码，默认 base64',
    },
    algo: {
      type: 'string',
      enum: ['md5', 'sha1', 'sha256', 'sha512'],
      description: 'hash 使用的算法，默认 sha256',
    },
    out: { type: 'string', enum: ['hex', 'base64'], description: 'hash 的输出格式，默认 hex' },
    count: { type: 'integer', description: 'uuid 生成数量（1-100，默认 1）' },
  },
  output: {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  },
  execute: (args) => {
    const action = String(args?.action ?? '')
    if (action === 'uuid') {
      const count = args?.count === undefined ? 1 : Math.max(1, Math.min(100, Math.trunc(Number(args.count))))
      return { ok: true, action, count, uuids: Array.from({ length: count }, () => randomUUID()) }
    }
    if (action === 'hash') {
      const input = requireString(args?.input, 'input')
      const algo = String(args?.algo ?? 'sha256')
      const out = String(args?.out ?? 'hex')
      return { ok: true, action, algo, out, digest: hashText(input, algo, out), bytes: Buffer.byteLength(input) }
    }
    if (action === 'encode' || action === 'decode') {
      const input = requireString(args?.input, 'input')
      const codec = String(args?.codec ?? 'base64')
      if (!CODECS.has(codec)) throw new Error(`不支持的 codec "${codec}"（可用 base64/base64url/url/hex）`)
      const value = action === 'encode' ? encodeText(input, codec) : decodeText(input, codec)
      return { ok: true, action, codec, value, inputBytes: Buffer.byteLength(input), outputBytes: Buffer.byteLength(value) }
    }
    throw new Error(`不支持的 action "${action}"（可用 encode/decode/hash/uuid）`)
  },
  timeoutMs: 2000,
}
