const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  
  // Define the username field with validation
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },

  // Define the email field with validation
  email:{
    type : String,
    unique: true,
    trim: true,
    lowercase: true
  },

  // Define the password field with validation
  password: {
    type: String,
    required: true,
  },

  // Define the createdAt field with a default value of the current date and time
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("User", userSchema);
