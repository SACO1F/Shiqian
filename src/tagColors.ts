const tones = ["sage", "blue", "rose", "amber", "violet", "teal"];

// A tag keeps its color when renamed, reordered or displayed in another window.
export function tagTone(id: string) {
  return tones[
    [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) %
      tones.length
  ];
}
