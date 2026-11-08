// Social post metadata (<stem>_post.json) for a rendered Fourier drawing. Pure functions.

// 3-6 hashtags per post (docs/export-pack.md)
export const DEFAULT_HASHTAGS = ['fourier', 'epicycles', 'mathart', 'math', 'satisfying', 'drawing'];
export const GUESS_HASHTAGS = ['guessthedrawing', 'fourier', 'mathart', 'satisfying', 'madewithcode'];

// "my-cat_line_art.svg" -> "my cat line art"
export function subjectFromPath(file) {
  const base = String(file).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'shape';
}

// "a, #b c" -> ["a", "b", "c"]; lowercase, deduped, letters/digits/underscore only.
export function parseHashtags(text) {
  const tags = String(text).split(/[\s,]+/).map(t => t.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '').toLowerCase()).filter(Boolean);
  return [...new Set(tags)];
}

function withArticle(subject) {
  if (/^(a|an|the|my|your|our|this)\s/i.test(subject)) return subject;
  return `${/^[aeiou]/i.test(subject) ? 'an' : 'a'} ${subject}`;
}

function clip(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function buildPost({ subject, circles, format = '9:16', buildUp = false, levels = [], title, description, hashtags, guess = false }) {
  // Guess mode never names the subject: the title, text and thumbnail must not spoil the answer.
  const t = clip(title || (guess ? `Guess the shape: ${levels.slice(0, 3).join(' circles… ')}…` : `Drawing ${withArticle(subject)} with ${circles} circles`), 100);
  const tags = hashtags ? parseHashtags(hashtags) : guess ? GUESS_HASHTAGS : DEFAULT_HASHTAGS;
  // #shorts is YouTube-only; on TikTok/Instagram/Facebook it marks the post as cross-posted.
  const ytTags = format === '9:16' && !tags.includes('shorts') ? [...tags, 'shorts'] : tags;
  const desc = description || (guess ? [
    `Every pass adds more spinning circles: ${levels.join(' → ')}. Guess the shape before the answer appears.`,
    'How many circles did you need? Tell me in the comments. A Fourier series in motion, made with code.',
  ].join('\n\n') : null) || [
    `${circles} spinning circles, each turning at its own constant speed, add up to draw this ${subject}. It's a Fourier series in motion: no hand drawing, just math.`,
    buildUp && levels.length > 1 ? `Watch it sharpen as the circles go from ${levels[0]} to ${levels[levels.length - 1]}.` : '',
    'What should the circles draw next? Tell me in the comments.',
  ].filter(Boolean).join('\n\n');
  const hash = tags.map(x => `#${x}`).join(' ');
  const ytHash = ytTags.map(x => `#${x}`).join(' ');
  return {
    title: t,
    description: desc,
    hashtags: tags,
    ...(guess ? { pinned_comment: `How many circles did you need to guess it? ${levels.slice(0, 3).join(', ')}…?` } : {}),
    platforms: {
      youtube: { title: t, description: `${desc}\n\n${ytHash}`, tags: ytTags, privacy: 'private', category_id: '27', made_for_kids: false },
      tiktok: { caption: clip(`${t} ${hash}`, 2200) },
      instagram: { caption: clip(`${t}\n\n${desc}\n\n${hash}`, 2200) },
      facebook: { title: t, description: `${desc}\n\n${hash}` },
    },
  };
}
