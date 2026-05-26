const registerForm =
document.getElementById(
"registerForm"
);

const verifyForm =
document.getElementById(
"verifyForm"
);

const message =
document.getElementById(
"message"
);

let currentEmail = "";

// REGISTER

registerForm.addEventListener(
"submit",
async (e)=>{

  e.preventDefault();

  const username =
  document.getElementById(
  "username"
  ).value;

  const email =
  document.getElementById(
  "email"
  ).value;

  const password =
  document.getElementById(
  "password"
  ).value;

  currentEmail = email;

  const response =
  await fetch("/register",{

    method:"POST",

    headers:{
      "Content-Type":
      "application/json"
    },

    body:JSON.stringify({

      username,
      email,
      password

    })

  });

  const data =
  await response.json();

  message.innerHTML =
  data.message;

});

// VERIFY

verifyForm.addEventListener(
"submit",
async (e)=>{

  e.preventDefault();

  const code =
  document.getElementById(
  "code"
  ).value;

  const response =
  await fetch("/verify",{

    method:"POST",

    headers:{
      "Content-Type":
      "application/json"
    },

    body:JSON.stringify({

      email:currentEmail,
      code

    })

  });

  const data =
  await response.json();

  message.innerHTML =
  data.message;

});
