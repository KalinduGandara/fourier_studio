import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPost, parseHashtags, subjectFromPath } from '../cli/post.mjs';

test('subjectFromPath turns file names into words', () => {
  assert.equal(subjectFromPath('/x/samples/my-cat_line_art.svg'), 'my cat line art');
  assert.equal(subjectFromPath('rocket.png'), 'rocket');
});

test('parseHashtags strips #, splits on commas/spaces and dedupes', () => {
  assert.deepEqual(parseHashtags('#Math, art  #math satisfying!'), ['math', 'art', 'satisfying']);
});

test('default post follows the export-pack contract', () => {
  const post = buildPost({ subject: 'owl', circles: 500, format: '9:16', buildUp: true, levels: [2, 10, 500] });
  assert.equal(post.title, 'Drawing an owl with 500 circles');
  assert.ok(post.description.includes('from 2 to 500'));
  assert.ok(!post.hashtags.includes('shorts'));
  assert.ok(post.platforms.youtube.tags.includes('shorts'));
  assert.ok(!post.platforms.tiktok.caption.includes('#shorts'));
  assert.ok(!post.platforms.instagram.caption.includes('#shorts'));
  assert.ok(post.hashtags.every(h => !h.startsWith('#')));
  const yt = post.platforms.youtube;
  assert.equal(yt.privacy, 'private');
  assert.equal(yt.made_for_kids, false);
  assert.ok(post.platforms.tiktok.caption.includes('#fourier'));
  assert.ok(post.platforms.instagram.caption.startsWith(post.title));
  assert.equal(post.platforms.facebook.title, post.title);
});

test('overrides win and titles are clipped to 100 chars', () => {
  const post = buildPost({ subject: 'cat', circles: 10, format: '16:9', title: 'x'.repeat(150), description: 'Hi', hashtags: 'a b' });
  assert.equal(post.title.length, 100);
  assert.equal(post.description, 'Hi');
  assert.deepEqual(post.hashtags, ['a', 'b']);
  assert.equal(buildPost({ subject: 'my dog', circles: 3 }).title, 'Drawing my dog with 3 circles');
  assert.ok(!buildPost({ subject: 'cat', circles: 3, format: '16:9' }).platforms.youtube.tags.includes('shorts'));
});
