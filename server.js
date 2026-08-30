require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const connectDB = require("./db");
const User = require("./models/User");
const Task = require("./models/Task");
const morgan = require("morgan");
const logger = require("./logger");

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Connect to Database
connectDB();

// 2. View Engine & Middleware
app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 3. Session Configuration (Keeps users logged in)
app.use(
  session({
    secret: process.env.SESSION_SECRET || "todosecretkey",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 24 hours
  }),
);

// 4. Logging Middleware (Morgan for HTTP request logging)
app.use(morgan("combined"));

// 4. Authentication Guard Middleware
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
};

// ------------------------------------------------------------------------------
// AUTHENTICATION ROUTES (Signup, Login, Logout)
// ------------------------------------------------------------------------------

// Root Route
app.get("/", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  res.redirect("/login");
});

// GET Signup Page
app.get("/signup", (req, res) => {
  res.render("signup");
});

// POST Signup (Create user with hashed password)
app.post("/signup", async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // Check if username already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.render("signup", {
        error: "Username already taken. Please pick another.",
      });
    }

    // Hash password securely with bcrypt
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashedPassword });

    // Auto-login after signup
    req.session.userId = user._id;
    req.session.username = user.username;
    res.redirect("/dashboard");
  } catch (err) {
    next(err);
  }
});

// GET Login Page
app.get("/login", (req, res) => {
  res.render("login");
});

// POST Login (Verify credentials)
app.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (!user) {
      return res.render("login", { error: "Invalid username or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render("login", { error: "Invalid username or password" });
    }

    // Set user session
    req.session.userId = user._id;
    req.session.username = user.username;
    res.redirect("/dashboard");
  } catch (err) {
    next(err);
  }
});

// GET Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ------------------------------------------------------------------------------
// // TODO TASK ROUTES (Protected by requireAuth)
// ------------------------------------------------------------------------------

// GET Dashboard (View and sort/filter tasks)
app.get("/dashboard", requireAuth, async (req, res, next) => {
  try {
    const filter = req.query.filter || "all";
    let query = { user: req.session.userId };

    if (filter === "pending") {
      query.status = "pending";
    } else if (filter === "completed") {
      query.status = "completed";
    } else {
      // "all" shows both pending and completed, but excludes deleted
      query.status = { $ne: "deleted" };
    }

    const tasks = await Task.find(query).sort({ createdAt: -1 });

    res.render("dashboard", {
      user: { username: req.session.username },
      tasks,
      currentFilter: filter,
    });
  } catch (err) {
    next(err);
  }
});

// POST Create New Task
app.post("/tasks", requireAuth, async (req, res, next) => {
  try {
    const { title } = req.body;
    if (title && title.trim() !== "") {
      await Task.create({
        title: title.trim(),
        user: req.session.userId,
        status: "pending",
      });
    }
    res.redirect("/dashboard");
  } catch (err) {
    next(err);
  }
});

// POST Mark Task as Completed
app.post("/tasks/:id/complete", requireAuth, async (req, res, next) => {
  try {
    await Task.findOneAndUpdate(
      { _id: req.params.id, user: req.session.userId },
      { status: "completed" },
    );
    res.redirect("/dashboard");
  } catch (err) {
    next(err);
  }
});

// POST Mark Task as Deleted
app.post("/tasks/:id/delete", requireAuth, async (req, res, next) => {
  try {
    await Task.findOneAndUpdate(
      { _id: req.params.id, user: req.session.userId },
      { status: "deleted" },
    );
    res.redirect("/dashboard");
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------------------
// GLOBAL ERROR HANDLING & 404 MIDDLEWARE
// ------------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).send('<h1>404 - Page Not Found</h1><a href="/">Go Home</a>');
});

app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).send("<h1>500 - Something went wrong on the server!</h1>");
});

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`🚀 Todo App is running at http://localhost:${PORT}`);
    console.log(`=============================================`);
  });
}

module.exports = app;