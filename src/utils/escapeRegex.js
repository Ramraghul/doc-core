/** Escape user input so it can be embedded in a RegExp as a literal (prevents ReDoS / regex injection). */
module.exports = (input) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
