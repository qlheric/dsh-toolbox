import { test } from 'node:test'
import assert from 'node:assert/strict'

import { decodeText, encodeText, hashText, spec } from '../lib/encoding.js'

test('base64 / base64url / url / hex 往返', () => {
  const text = '中文 abc +/=?'
  for (const codec of ['base64', 'base64url', 'url', 'hex']) {
    assert.equal(decodeText(encodeText(text, codec), codec), text, `codec=${codec} 往返失败`)
  }
  assert.equal(encodeText('foo', 'base64'), 'Zm9v')
  assert.equal(encodeText('foo', 'hex'), '666f6f')
  assert.equal(encodeText('a b', 'url'), 'a%20b')
})

test('解码非法输入要报错', () => {
  assert.throws(() => decodeText('abc', 'hex'), /长度必须是偶数/)
  assert.throws(() => decodeText('zz', 'hex'), /只允许 0-9a-f/)
  assert.throws(() => encodeText('x', 'rot13'), /不支持的 codec/)
})

test('哈希与已知向量一致', () => {
  assert.equal(hashText('abc', 'md5'), '900150983cd24fb0d6963f7d28e17f72')
  assert.equal(hashText('abc', 'sha1'), 'a9993e364706816aba3e25717850c26c9cd0d89d')
  assert.equal(hashText('abc', 'sha256'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(
    hashText('abc', 'sha512'),
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
  )
  assert.equal(hashText('abc', 'sha256', 'base64'), 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=')
  assert.throws(() => hashText('abc', 'sha3'), /不支持的 algo/)
})

test('uuid 与 spec.execute 形状', () => {
  const one = spec.execute({ action: 'uuid' })
  assert.equal(one.uuids.length, 1)
  assert.match(one.uuids[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  const many = spec.execute({ action: 'uuid', count: 5 })
  assert.equal(many.count, 5)
  assert.equal(new Set(many.uuids).size, 5)
  const capped = spec.execute({ action: 'uuid', count: 9999 })
  assert.equal(capped.count, 100)
})

test('encode/hash 走 spec.execute', () => {
  const encoded = spec.execute({ action: 'encode', input: 'hi', codec: 'base64' })
  assert.equal(encoded.value, 'aGk=')
  const hashed = spec.execute({ action: 'hash', input: 'hi' })
  assert.equal(hashed.algo, 'sha256')
  assert.equal(hashed.digest.length, 64)
  assert.throws(() => spec.execute({ action: 'encode', input: '' }), /非空字符串/)
})
