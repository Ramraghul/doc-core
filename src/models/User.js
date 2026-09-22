const mongoose = require('mongoose');
const applyToJSON = require('../utils/toJSON');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    // select:false => the hash is never loaded unless a query explicitly asks for it.
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
  },
  { timestamps: true },
);

applyToJSON(userSchema, ['passwordHash']);

module.exports = mongoose.model('User', userSchema);
