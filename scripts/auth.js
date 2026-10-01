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

const signupForm=document.getElementById("signup-form");
const loginForm=document.getElementById("login-form");
const errorEl=document.getElementById("error-msg")||document.getElementById("login-error-msg");
const resetLink=document.getElementById("reset-password");
const googleButtons=document.querySelectorAll("[data-google-auth]");

function showMessage(text,good=false){if(!errorEl)return;errorEl.textContent=text;errorEl.style.color=good?"#7ee787":"#ff6b6b";}
function friendlyError(error){
  const messages={"auth/email-already-in-use":"An account already exists for this email.","auth/invalid-email":"Please enter a valid email address.","auth/weak-password":"Choose a stronger password.","auth/invalid-credential":"Email or password is incorrect.","auth/user-disabled":"This account has been disabled.","auth/too-many-requests":"Too many attempts. Please wait and try again.","auth/popup-closed-by-user":"Google sign-in was cancelled.","auth/popup-blocked":"Your browser blocked the sign-in window. Please allow popups and try again.","auth/account-exists-with-different-credential":"An account already exists with a different sign-in method."};
  return messages[error?.code]||"Something went wrong. Please try again.";
}
async function createUserRecord(user,name){
  await setDoc(doc(db,"users",user.uid),{displayName:name,email:user.email||null,provider:user.providerData?.[0]?.providerId||"password",updatedAt:serverTimestamp(),createdAt:serverTimestamp()},{merge:true});
}
async function googleSignIn(){
  const credential=await signInWithPopup(auth,new GoogleAuthProvider());
  await createUserRecord(credential.user,credential.user.displayName||"");
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
    window.location.href="home.html";
  }catch(error){console.error(error);showMessage(friendlyError(error));button.disabled=false;}
});
resetLink?.addEventListener("click",async(event)=>{
  event.preventDefault();const email=document.getElementById("login-email")?.value.trim()||"";
  if(!email){showMessage("Enter your email first, then choose Forgot password.");return;}
  try{await sendPasswordResetEmail(auth,email);showMessage("Password reset email sent.",true);}catch(error){console.error(error);showMessage(friendlyError(error));}
});
document.querySelectorAll("[data-logout]").forEach(button=>button.addEventListener("click",async(event)=>{event.preventDefault();await signOut(auth);window.location.href="login.html";}));
