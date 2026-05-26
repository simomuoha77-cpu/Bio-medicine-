import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const verificationCodes = {};

// MAIL TRANSPORTER

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// REGISTER ROUTE

app.post("/register", async (req, res) => {

  try{

    const { email } = req.body;

    if(!email){
      return res.json({
        success:false,
        message:"Email required"
      });
    }

    // GENERATE 6 DIGIT CODE

    const code =
    Math.floor(100000 + Math.random() * 900000);

    verificationCodes[email] = code;

    // SEND EMAIL

    await transporter.sendMail({

      from: process.env.EMAIL_USER,

      to: email,

      subject: "MASTER BIOMEDS Verification Code",

      html: `
      <div style="
      font-family:Arial;
      padding:30px;
      background:#071018;
      color:white;
      ">

      <h1 style="color:#00d9ff;">
      MASTER BIOMEDS
      </h1>

      <p>
      Your verification code is:
      </p>

      <h2 style="
      background:#00d9ff;
      color:black;
      padding:15px;
      border-radius:10px;
      width:fit-content;
      ">
      ${code}
      </h2>

      </div>
      `
    });

    res.json({
      success:true,
      message:"Verification code sent"
    });

  }catch(error){

    console.log(error);

    res.json({
      success:false,
      message:"Server error"
    });

  }

});

// VERIFY ROUTE

app.post("/verify", (req,res)=>{

  const { email, code } = req.body;

  if(
    verificationCodes[email] ==
    code
  ){

    delete verificationCodes[email];

    return res.json({
      success:true,
      message:"Account verified"
    });
  }

  res.json({
    success:false,
    message:"Invalid code"
  });

});

// START SERVER

app.listen(process.env.PORT, ()=>{

  console.log(`
  Server Running:
  http://localhost:${process.env.PORT}
  `);

});
