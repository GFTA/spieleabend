// Avatar library and colours shared by the servers (validation), the games and the start page.
// The first 16 avatars are the original ones, so saved rooms and profiles stay valid.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SAAvatars = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const AVATARS = [
    "🦊", "🐼", "🐸", "🐯", "🦁", "🐨", "🐙", "🦄", "🐵", "🐧", "🦉", "🐢", "🐳", "🦖", "👻", "🤠",
    "🐶", "🐱", "🐭", "🐹", "🐰", "🐻", "🐷", "🐮", "🐔", "🐤", "🦆", "🦅", "🦇", "🐺", "🐗", "🐴",
    "🐝", "🐛", "🦋", "🐌", "🐞", "🦂", "🐍", "🦎", "🐊", "🐬", "🦈", "🐡", "🦀", "🦑", "🦞", "🐘",
    "🦒", "🦓", "🦘", "🦔", "🦦", "🦥", "🦩", "🦚", "🦜", "🦝", "🦙",
    "😎", "🤓", "🥳", "😈", "🤖", "👽", "💀", "🎃", "🤡", "🧙", "🧛", "🧜", "🥷", "🦸", "👑"
  ];
  // avatar backgrounds: soft enough for light and dark tables, the same names/values everywhere
  const COLORS = ["#e0393e", "#f28a30", "#f2c230", "#8bc34a", "#2fa35b", "#1fb5a8", "#2d9fd6", "#2d6fd6", "#7b5bd6", "#b04fd0", "#e05a9c", "#8a94a6"];
  return { AVATARS, COLORS, isColor: (c) => COLORS.includes(c) };
});
