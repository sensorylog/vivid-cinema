import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { doc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { startLibrarySync } from "./library.js";

const signupForm=document.getElementById("signup-form");
const loginForm=document.getElementById("login-form");
const errorEl=document.getElementById("error-msg")||document.getElementById("login-error-msg");
const resetLink=document.getElementById("reset-password");
const forgotForm=document.getElementById("forgot-form");
const forgotMessage=document.getElementById("forgot-message");
const googleButtons=document.querySelectorAll("[data-google-auth]");

try {
  const rememberedEmail=sessionStorage.getItem("vivid:signup-email");
  const emailInput=document.getElementById("email");
  if(rememberedEmail && emailInput){emailInput.value=rememberedEmail;sessionStorage.removeItem("vivid:signup-email");}
} catch {}

function showMessage(text,good=false){if(!errorEl)return;errorEl.textContent=text;errorEl.style.color=good?"#7ee787":"#ff6b6b";}
function friendlyError(error){
  const messages={"auth/email-already-in-use":"An account already exists for this email.","auth/invalid-email":"Please enter a valid email address.","auth/weak-password":"Choose a stronger password.","auth/invalid-credential":"Email or password is incorrect.","auth/user-disabled":"This account has been disabled.","auth/too-many-requests":"Too many attempts. Please wait and try again.","auth/popup-closed-by-user":"Google sign-in was cancelled.","auth/popup-blocked":"Your browser blocked the sign-in window. Please allow popups and try again.","auth/account-exists-with-different-credential":"An account already exists with a different sign-in method.","auth/network-request-failed":"Connection problem. Check your internet connection and try again.","auth/requires-recent-login":"For security, please sign in again and retry."};
  return messages[error?.code]||"Something went wrong. Please try again.";
}
async function createUserRecord(user,name){
  await setDoc(doc(db,"users",user.uid),{displayName:name,email:user.email||null,provider:user.providerData?.[0]?.providerId||"password",updatedAt:serverTimestamp(),createdAt:serverTimestamp()},{merge:true});
}
async function googleSignIn(){
  const credential=await signInWithPopup(auth,new GoogleAuthProvider());
  await createUserRecord(credential.user,credential.user.displayName||"");
  await startLibrarySync();
  window.location.href="home.html";
}
googleButtons.forEach(button=>button.addEventListener("click",async()=>{
  button.disabled=true;showMessage("Connecting to Google…",true);
  try{await googleSignIn();}catch(error){console.error(error);showMessage(friendlyError(error));button.disabled=false;}
}));
signupForm?.addEventListener("submit",async(event)=>{
  event.preventDefault();
  const name=document.getElementById("username")?.value.trim()||"",email=document.getElementById("email")?.value.trim()||"",password=document.getElementById("password")?.value||"",button=signupForm.querySelector("button[type=submit]");
  if(password.length<6){showMessage("Password must be at least 6 characters.");return;}
  button.disabled=true;showMessage("Creating your account…",true);
  try{
    const credential=await createUserWithEmailAndPassword(auth,email,password);
    if(name)await updateProfile(credential.user,{displayName:name});
    await createUserRecord(credential.user,name);
    await sendEmailVerification(credential.user);
    showMessage("Account created. Check your email to verify your address, then log in.",true);
    await signOut(auth);
    button.disabled=false;
  }catch(error){console.error(error);showMessage(friendlyError(error));button.disabled=false;}
});
loginForm?.addEventListener("submit",async(event)=>{
  event.preventDefault();
  const email=document.getElementById("login-email")?.value.trim()||"",password=document.getElementById("login-password")?.value||"",button=loginForm.querySelector("button[type=submit]");
  button.disabled=true;showMessage("Signing in…",true);
  try{
    const credential=await signInWithEmailAndPassword(auth,email,password);
    if(!credential.user.emailVerified){await signOut(auth);showMessage("Please verify your email before signing in. Check your inbox.");button.disabled=false;return;}
    await startLibrarySync();
    window.location.href="home.html";
  }catch(error){console.error(error);showMessage(friendlyError(error));button.disabled=false;}
});
document.getElementById("resend-verification")?.addEventListener("click",async()=>{
  const user=auth.currentUser;
  if(!user){showMessage("Sign in first, then resend verification.");return;}
  try{await sendEmailVerification(user);showMessage("Verification email sent. Check your inbox and spam folder.",true);}catch(error){showMessage(friendlyError(error));}
});

document.querySelectorAll("[data-password-toggle]").forEach(toggle=>toggle.addEventListener("click",()=>{const input=document.querySelector(toggle.dataset.passwordToggle);if(!input)return;const visible=input.type==="text";input.type=visible?"password":"text";toggle.textContent=visible?"Show":"Hide";toggle.setAttribute("aria-label",visible?"Show password":"Hide password");}));

forgotForm?.addEventListener("submit",async(event)=>{
  event.preventDefault();
  const email=document.getElementById("reset-email")?.value.trim()||"";
  const button=forgotForm.querySelector("button[type=submit]");
  if(!email)return;
  button.disabled=true;
  if(forgotMessage){forgotMessage.textContent="Sending secure reset link…";forgotMessage.style.color="#7ee787";}
  try{await sendPasswordResetEmail(auth,email);if(forgotMessage)forgotMessage.textContent="If an account exists for that email, a reset link is on its way.";forgotForm.reset();}
  catch(error){if(forgotMessage){forgotMessage.textContent=friendlyError(error);forgotMessage.style.color="#ff6b6b";}}
  finally{button.disabled=false;}
});

resetLink?.addEventListener("click",async(event)=>{
  event.preventDefault();const email=document.getElementById("login-email")?.value.trim()||"";
  if(!email){showMessage("Enter your email first, then choose Forgot password.");return;}
  try{await sendPasswordResetEmail(auth,email);showMessage("Password reset email sent.",true);}catch(error){console.error(error);showMessage(friendlyError(error));}
});
document.querySelectorAll("[data-logout]").forEach(button=>button.addEventListener("click",async(event)=>{event.preventDefault();await signOut(auth);window.location.href="login.html";}));
