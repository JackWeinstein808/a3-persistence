require('dotenv').config();
const uri = process.env.MONGODB_URI;

let activeUser = "";
const express = require("express"),
  { MongoClient, ObjectId } = require("mongodb"),
  app = express(),
  session = require('express-session'),
  MongoStore = require('connect-mongo');
  bodyParser = require('body-parser'),
  passport = require('./public/js/passport'),
  mongoose = require('mongoose'),
  User = require('./public/js/user.model');

app.use(express.static("public") )
app.use(express.json() )

// Session Middleware 
app.use(session({
  secret: 'your secure secret here',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    clientPromise: MongoClient.connect(uri)
  })
}));

// Passport Middleware
app.use(passport.initialize());
app.use(passport.session()); 

// Body Parser Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const bcrypt = require('bcryptjs'); // For password hashing

// Example middleware for route protection
function isLoggedIn(req, res, next) {
  if (req.session.isLoggedIn) {
    next(); // User is logged in, proceed to the route
  } else {
    res.redirect('/index'); // Redirect to the login page
  }
}

// Protected authentication check route
app.get('/check-auth', isLoggedIn, (req, res) => {
  // Access the username from the user object in the session
  const username = req.body.username; 
  res.json({ 
    message: 'User is authenticated', 
    username: username 
  });
});

//login route
app.post('/login', async (req, res) => {
  try {
    let userCollection = await client.db("foodLogData").collection("users");

    // Check for existing username
    const existingUser = await userCollection.findOne({ username: req.body.username });
    if (existingUser) {
      const isPasswordMatch = await bcrypt.compare(req.body.password, existingUser.password);
      if(isPasswordMatch) {
        // Set session variable to indicate user is logged in
        req.session.isLoggedIn = true;
        activeUser = req.body.username;
        passport.authenticate('local')(req, res, function() {
          res.json({ success: true, message: "Login successful" });
        });

      }
      else { // Incorrect password
        res.status(401).json({ success: false, message: 'Incorrect password' });
      }
    }
    else { // Username not found
      res.status(401).json({ success: false, message: 'Username not found' });
    }

  } catch (error) {
    console.error("Login error:", error.message); // Detailed error 
    res.status(500).json({ success: false, message: "Login error" });
  }
});

// Register Route
app.post('/register', async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10); 
    const newUser = new User({
      username: req.body.username,
      password: hashedPassword
    });
    let userCollection = await client.db("foodLogData").collection("users");

    // Check for existing username
    const existingUser = await userCollection.findOne({ username: req.body.username });
    if (existingUser) {
      return res.status(409).json({ success: false, message: "Username already exists" });
    }

    // Create new user object ...
    const result = await userCollection.insertOne(newUser);

    // Create new collection for user
    const userCollectionName = "foodLog_" + req.body.username // Unique name
    await client.db("foodLogData").createCollection(userCollectionName);

    res.json({ success: true, message: "Registration successful" });

  } catch (error) {
    console.error("Registration error:", error.message); // Detailed error 
    res.status(500).json({ success: false, message: "Registration error" });
  }
});

app.get('/logout', (req, res) => {
  req.logout(function(err) { // Add the callback function
    if (err) { 
      return next(err); // Pass errors to error handler 
    }
    activeUser = "";
    res.json({ success: true, message: "Logged out" });
  }); 
});

const client = new MongoClient( uri )

async function run() {
  try {
    await client.connect();
  }
  catch (error) {
    console.error("Error connecting to MongoDB:", error);
    res.status(503).send("Error connecting to database"); // Send error to client
  }
}

// Route to get all docs
app.get('/docs', async (req, res) => {
  const collectionName = "foodLog_" + activeUser;
  const collection = client.db("foodLogData").collection(collectionName);
  try {
    const docs = await collection.find({}).toArray();
    res.json(docs);
  } 
  catch (error) { 
    console.error("Error fetching docs:", error);
    res.status(500).send("Error retrieving documents");
  } 
});

app.post('/add', async (req,res) => {
  const collectionName = "foodLog_" + activeUser;
  const collection = client.db("foodLogData").collection(collectionName);
  const newItem = req.body;
  const updatedItem = calculateItemProperties(newItem);

  const result = await collection.insertOne( updatedItem )
  res.json( result )
})

app.delete('/delete', async (req, res) => {
  const collectionName = "foodLog_" + activeUser;
  const collection = client.db("foodLogData").collection(collectionName);
  const itemId = req.body.itemId;  
  try {
    // Directly create ObjectId from the string ID
    const objectId = new ObjectId(itemId);
    const deleteResult = await collection.deleteOne({ _id: objectId });

    if (deleteResult.deletedCount === 1) {
      res.status(200).send("Document deleted");
    } else {
      res.status(404).send("Document not found");
    }
  } catch (error) {
    console.error("Error deleting document:", error);
    res.status(500).send("Error deleting document");
  }
});

app.post('/edit-item', async (req, res) => {
  const collectionName = "foodLog_" + activeUser;
  const collection = client.db("foodLogData").collection(collectionName);
  const itemId = req.body.itemId;
  const updatedData = req.body; 
  delete updatedData.itemId;  // Remove itemId from the update object

  const finalData = calculateItemProperties(updatedData);

  try {
    const updateResult = await collection.updateOne({ _id: new ObjectId(itemId) }, { $set: finalData });

    if (updateResult.modifiedCount === 1) {
      res.status(200).send("Document updated");
    } else {
      res.status(404).send("Document not found");
    }
  } catch (error) {
    console.error("Error updating document:", error);
    res.status(500).send("Error updating document");
  }
});

function calculateItemProperties(item) {
  item.total = (parseFloat(item.wages, 10) + parseFloat(item.tips, 10)).toFixed(2);
  item.gasUsed = (parseFloat(item.miles, 10) / parseFloat(item.mpg, 10)).toFixed(2);
  item.gasCost = (parseFloat(item.gasUsed, 10) * parseFloat(item.gasPrice, 10)).toFixed(2); //compute cost of gas
  item.income = (parseFloat(item.total, 10) - parseFloat(item.gasCost, 10)).toFixed(2); //compute income
  item.hourlyPay = (parseFloat(item.income, 10)/(parseFloat(item.time, 10)/60)).toFixed(2); //compute hourly pay
  return item; // Return the modified item
}

run()
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening to port ${port}`));
