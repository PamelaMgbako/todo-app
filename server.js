require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const connectDB = require("./db");
const User = require("./models/User");
const Task = require("./models/Task");
const morgan = require("morgan");
const logger = require("./logger");
const { Server} = require ('socket.io');
const http = require('http');
const jwt = require('jsonwebtoken');
const nodemailer = require("nodemailer");


const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;



//--- Socket.io JWT Authentication Middleware---
io.use((socket, next) => {

  //Grabs the token sent over by the client during handshake
  const token = socket.handshake.auth.token;
  
  //if there is no token, reject the connection
  if(!token){
    return next(new Error("Authentication error: No token provided"));
  }
  try{
    //Ensure the JWT token is verified using the same secret used during login
    const decoded = jwt.verify(
      token, 
      process.env.JWT_SECRET || "default_todo_jwt_secret"
    );
    
    //Attahc the user ID to the socket 
    socket.userId = decoded.userId;
    next();
  }
  catch(err){
    return next(new Error("Aurthentication error: Invalid token"));
  }
});

// Handles Socket.io Connections
io.on("connection", (socket) =>{
  console.log(`User connected: ${socket.userId}`);

  //Joining a private room matching user ID
  socket.join(socket.userId.toString());

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.userId}`);
  });
});
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

// GET Login Page; if already logged in, redirect to dashboard
app.get("/login", (req, res) => {
  res.render("login");
});

// POST Login (Verify credentials)
app.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    // If user not found or password doesn't match, show error
    if (!user) {
      return res.render("login", { error: "Invalid username or password" });
    }

    // Compare provided password with hashed password
    const isMatch = await bcrypt.compare(password, user.password);

    // If password doesn't match, show error
    if (!isMatch) {
      return res.render("login", { error: "Invalid username or password" });
    }

//Generate JWT token for the user
const token = jwt.sign(
  { userId: user._id, username: user.username },
  process.env.JWT_SECRET || "default_todo_jwt_secret",
  { expiresIn: "1d" }
);

  // Save token to session so the dashboard view has access to it
  req.session.token = token;

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


    // Apply filter based on query parameter
    if (filter === "pending") {
      query.status = "pending";
    } else if (filter === "completed") {
      query.status = "completed";
    } 
     else if (filter === "overdue") {
      query.status = "overdue";
    } else {
      // "all" shows both pending and completed, but excludes deleted
      query.status = { $ne: "deleted" };
    }


    // Fetch tasks based on the filter and sort by creation date (newest first)
    const tasks = await Task.find(query).sort({ createdAt: -1 });


    // Render the dashboard with tasks and current filter
    res.render("dashboard", {
      user: { username: req.session.username },
      tasks,
      currentFilter: filter,
      token: req.session.token, // Pass the JWT token to the dashboard view
    });
  } catch (err) {
    next(err);
  }
});

// POST Create New Task
app.post("/tasks", requireAuth, async (req, res, next) => {
  try {
    const { title, dueDate } = req.body;
    if (title && title.trim() !== "" && dueDate) {
      
      await Task.create({
        dueDate: dueDate,
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

    // capture the task that is being marked as completed and update its status to "completed"
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, user: req.session.userId },
      { status: "completed" },
      { new: true }
    );

    // emit real time notifications only to the task owner (user) using socket.io
    if(task) {
      io.to(task.user.toString()).emit("taskCompleted", {
        message: `Task "${task.title}" has been completed!`,
        taskId: task._id,
      });
    }

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
      { new: true }
    );

    // Emit a "taskDeleted" event to all connected clients
    res.redirect("/dashboard");
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------------------
// GLOBAL ERROR HANDLING & 404 MIDDLEWARE
// ------------------------------------------------------------------------------

// 404 Not Found Middleware
app.use((req, res) => {
  res.status(404).send('<h1>404 - Page Not Found</h1><a href="/">Go Home</a>');
});

// 500 Internal Server Error Middleware
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).send("<h1>500 - Something went wrong on the server!</h1>");
});

// Email transporter configuration for sending notifications
const transporter = nodemailer.createTransport({
  service: "gmail", 
  auth:{
    user: process.env.EMAIL_USER || "test@example.com",
    pass: process.env.EMAIL_PASS || "test_password"
  }
});

//Helper function to send email notification
const sendOverdueEmail =  async (userEmail, taskTitle) => {

  if(!userEmail) return logger.error("No email provided for overdue task notification.");

  const mailOptions = {
    from: process.env.EMAIL_USER || "NOREPLY@TODOAPP.COM",
    to: userEmail,
    subject: `Task Overdue Notification: "${taskTitle}"`,
    text: `Hello, your task "${taskTitle}" is overdue. Please check your dashboard to update it.`,
  };

  try{
    await transporter.sendMail(mailOptions);
    console.log(`Overdue email sent to ${userEmail} for task "${taskTitle}"`);
  } catch (err) {
    logger.error("Error sending overdue email:", err.message);
  }
};

// Check for overdue tasks and update their status to "overdue"
const checkOverdueTasks = async() => {
  try{
    const now = new Date();

    //Find all pending tasks whose due date has passed
    const overdueTasks = await Task.find({
      status: "pending",
      dueDate: { $lt: now },
    }).populate("user");

    // If we found any, update their status to o'overdue'
    for (const task of overdueTasks) {
      task.status = "overdue";
      await task.save();
      console.log(`Task "${task.title}" is overdue and has been updated to "overdue" status.`);

      //Only run notification logic IF task.user exists:
      if (task.user) {
        const userId = task.user._id ? task.user._id.toString() : task.user.toString();

        io.to(userId).emit("taskOverdue", {
          message: `Alert: Task "${task.title}" is now overdue!`,
          taskId: task._id,
        });

        if (task.user.email) {
          await sendOverdueEmail(task.user.email, task.title);
        }
      }
    }
  }
  // Log any errors that occur during the process
  catch (err) {
    logger.error("Error checking overdue tasks:", err.message);
  }
};

// Check for overdue tasks every minute
setInterval(checkOverdueTasks, 60000);


// Start Server
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`🚀 Todo App is running at http://localhost:${PORT}`);
    console.log(`=============================================`);
  });
}

module.exports = app;