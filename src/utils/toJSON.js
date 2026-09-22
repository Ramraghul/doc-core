/** Shared Mongoose toJSON transform: `_id` -> `id`, and never leak `__v` or hidden fields. */
module.exports = function applyToJSON(schema, hidden = []) {
  schema.set('toJSON', {
    virtuals: false,
    transform(_doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      hidden.forEach((key) => delete ret[key]);
      return ret;
    },
  });
};
