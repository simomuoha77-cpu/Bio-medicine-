const loginForm =
document.getElementById(
"loginForm"
);

const message =
document.getElementById(
"message"
);

loginForm.addEventListener(
"submit",
async (e)=>{

  e.preventDefault();

  const email =
  document.getElementById(
  "email"
  ).value;

  const password =
  document.getElementById(
  "password"
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
