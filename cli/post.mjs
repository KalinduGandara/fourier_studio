// Social post metadata (<stem>_post.json) for a rendered Fourier drawing. Pure functions.

export const DEFAULT_HASHTAGS = [
  'fourier', 'fouriertransform', 'epicycles', 'mathart', 'math', 'satisfying', 'oddlysatisfying', 'drawing', 'asmr',
];

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

export function buildPost({ subject, circles, format = '9:16', buildUp = false, levels = [], title, description, hashtags }) {
  const t = clip(title || `Drawing ${withArticle(subject)} with ${circles} circles`, 100);
  const tags = hashtags ? parseHashtags(hashtags) : [...DEFAULT_HASHTAGS, ...(format === '9:16' ? ['shorts'] : [])];
  const desc = description || [
    `${circles} spinning circles, each turning at its own constant speed, add up to draw this ${subject}. It's a Fourier series in motion: no hand drawing, just math.`,
    buildUp && levels.length > 1 ? `Watch it sharpen as the circles go from ${levels[0]} to ${levels[levels.length - 1]}.` : '',
    'What should the circles draw next? Tell me in the comments.',
  ].filter(Boolean).join('\n\n');
  const hash = tags.map(x => `#${x}`).join(' ');
  return {
    title: t,
    description: desc,
    hashtags: tags,
    platforms: {
      youtube: { title: t, description: `${desc}\n\n${hash}`, tags, privacy: 'private', category_id: '27', made_for_kids: false },
      tiktok: { caption: clip(`${t} ${hash}`, 2200) },
      instagram: { caption: clip(`${t}\n\n${desc}\n\n${hash}`, 2200) },
      facebook: { title: t, description: `${desc}\n\n${hash}` },
    },
  };
}
