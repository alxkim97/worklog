import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relink, sameToken, WEB } from '../lib/server.js'
import { card, VIEW_URL } from '../lib/lineCards.js'

test('card buttons are pointed at the secret view link', () => {
  const c = card({ title: 'T', sections: [], alt: 'a' })
  assert.equal(c.footer.contents[0].action.uri, VIEW_URL)
  relink(c, `${WEB}/?v=abc123abc123abc123abc123`)
  assert.equal(c.footer.contents[0].action.uri, `${WEB}/?v=abc123abc123abc123abc123`)
})

test('token compare', () => {
  assert.ok(sameToken('a'.repeat(32), 'a'.repeat(32)))
  assert.ok(!sameToken('a'.repeat(32), 'a'.repeat(31) + 'b'))
  assert.ok(!sameToken('', 'x'))
  assert.ok(!sameToken(undefined, 'x'))
})
