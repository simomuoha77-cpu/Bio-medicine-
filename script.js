const registerForm =
document.getElementById(
"registerForm"
);

const verifyForm =
document.getElementById(
"verifyForm"
);

const loginForm =
document.getElementById(
"loginForm"
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

// LOGIN

loginForm.addEventListener(
"submit",
async (e)=>{

  e.preventDefault();

  const email =
  document.getElementById(
  "loginEmail"
  ).value;

  const password =
  document.getElementById(
  "loginPassword"
  ).value;

  const response =
  await fetch("/login",{

    method:"POST",

    headers:{
      "Content-Type":
      "application/json"
    },

    body:JSON.stringify({

      email,
      password

    })

  });

  const data =
  await response.json();

  if(data.success){

    message.innerHTML =

    `
    Welcome
    ${data.user.username}
    ✅
    `;

  }else{

    message.innerHTML =
    data.message;

  }

});
