require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const axios = require("axios");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;


const morgan = require("morgan");
const NodeCache = require("node-cache");

const app = express();

const PORT = 3000;


app.get("/auth/google",
    passport.authenticate("google", {
        scope: ["profile", "email"]
    })
);

app.get("/auth/google/callback",
    passport.authenticate("google", {
        failureRedirect: "/"
    }),
    (req, res) => {
        res.redirect("/result");
    }
);
 

// Logging Middleware
app.use(morgan("dev"));

// Custom Request Middleware
app.use((req, res, next) => {
    console.log("Request Method:", req.method);
    console.log("Request URL:", req.url);
    next();
});

// Cache setup
const cache = new NodeCache({ stdTTL: 300 });

// Background Task Queue
let taskQueue = [];

function processBackgroundTasks() {
    if (taskQueue.length > 0) {
        const task = taskQueue.shift();

        console.log("Processing Background Task:", task);

        setTimeout(() => {
            console.log("Background Task Completed:", task.message);
        }, 3000);
    }
}

setInterval(processBackgroundTasks, 5000);


// MongoDB Connection
mongoose.connect("mongodb://127.0.0.1:27017/taskDB")
.then(() => console.log("MongoDB Connected"))
.catch((err) => console.log(err));

app.set("view engine", "ejs");

app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: "mysecretkey",
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: "Too many requests. Please try again later."
});

app.use(limiter);

// User Schema
const userSchema = new mongoose.Schema({
    name: String,
    email: {
        type: String,
        lowercase: true,
        trim: true
    },
    password: String,
    phone: String,
    age: Number
});

const User = mongoose.model("User", userSchema);

// Google OAuth
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,

clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
},
function(accessToken, refreshToken, profile, done) {
    return done(null, profile);
}));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

// Home Page
app.get("/", (req, res) => {
    res.render("index", {
        user: req.user || null,
        weather: null,
        error: null
    });
});

// Normal Signup
app.post("/signup", async (req, res) => {
    try {
        let { name, email, password, phone, age } = req.body;

        email = email.trim().toLowerCase();
        password = password.trim();

        const hashedPassword = await bcrypt.hash(password, 10);

        let existingUser = await User.findOne({ email });

        if (existingUser) {
            existingUser.name = name;
            existingUser.password = hashedPassword;
            existingUser.phone = phone;
            existingUser.age = age;

            await existingUser.save();
                taskQueue.push({
    id: Date.now(),
    message: `Profile update task for ${email}`
});

            return res.send("Signup Successful");
        }

        const newUser = new User({
            name,
            email,
            password: hashedPassword,
            phone,
            age
        });

        await newUser.save();

        taskQueue.push({
    id: Date.now(),
    message: `Welcome email task for ${email}`
});


        res.send("Signup Successful");

    } catch (err) {
        console.log(err);
        res.send("Signup Error");
    }
});

// Get Users
app.get("/api/users", async (req, res) => {
    const users = await User.find({}, "-password");
    res.json(users);
});

// Delete User
app.delete("/api/users/:id", async (req, res) => {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User Deleted" });
});

// Normal Login
app.post("/login", async (req, res) => {
    try {
        let { email, password } = req.body;

        email = email.trim().toLowerCase();
        password = password.trim();

        const user = await User.findOne({ email });

        if (!user) {
            return res.send("User Not Found");
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.send("Invalid Password");
        }

        req.session.normalUser = {
            id: user._id,
            name: user.name,
            email: user.email
        };

        res.send("Login Successful");

    } catch (err) {
        console.log(err);
        res.send("Login Error");
    }
});

// Google Login
app.get("/auth/google",
    passport.authenticate("google", {
        scope: ["profile", "email"]
    })
);

// Google Callback
app.get("/auth/google/callback",
    passport.authenticate("google", {
        failureRedirect: "/"
    }),
    (req, res) => {
        res.redirect("/result");
    }
);

// Protected Result Page
app.get("/result", isAuthenticated, (req, res) => {
    res.render("result", {
        user: req.user
    });
});

// Weather API
app.post("/weather", async (req, res) => {
    try {
        const city = req.body.city;

        if (!city) {
            return res.render("index", {
                user: req.user || null,
                weather: null,
                error: "Please enter a city name"
            });
        }

        const geoResponse = await axios.get(
            `https://geocoding-api.open-meteo.com/v1/search?name=${city}&count=1`
        );

        if (!geoResponse.data.results) {
            return res.render("index", {
                user: req.user || null,
                weather: null,
                error: "City not found"
            });
        }

        const location = geoResponse.data.results[0];

        const weatherResponse = await axios.get(
            `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current_weather=true`
        );

        const weatherData = {
            city: location.name,
            country: location.country,
            temperature: weatherResponse.data.current_weather.temperature,
            windspeed: weatherResponse.data.current_weather.windspeed
        };

        res.render("index", {
            user: req.user || null,
            weather: weatherData,
            error: null
        });

    } catch (err) {
        console.log(err);

        res.render("index", {
            user: req.user || null,
            weather: null,
            error: "Something went wrong while fetching weather data"
        });
    }
});

// Logout
app.get("/logout", (req, res) => {
    req.logout(() => {
        res.redirect("/");
    });
});

// Authentication Middleware
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }

    res.redirect("/");
}

// Background Task Route
app.post("/background-task", (req, res) => {
    const task = {
        id: Date.now(),
        message: "Sending welcome email / processing task"
    };

    taskQueue.push(task);

    res.json({
        message: "Task added to background queue",
        task
    });
});

// Cache Example Route
app.get("/cached-users", async (req, res) => {
    const cachedUsers = cache.get("users");

    if (cachedUsers) {
        return res.json({
            message: "Data from Cache",
            users: cachedUsers
        });
    }

    const users = await User.find({}, "-password");

    cache.set("users", users);

    res.json({
        message: "Data from Database",
        users
    });
});

// Clear Cache Route
app.get("/clear-cache", (req, res) => {
    cache.flushAll();

    res.send("Cache cleared successfully");
});


// 404 Error
app.use((req, res) => {
    res.status(404).send("404 Page Not Found");
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
