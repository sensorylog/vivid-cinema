import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { doc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
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
function postAuthDestination(){
  const raw=new URLSearchParams(window.location.search).get("returnTo");
  if(!raw)return "home.html";
  try{
    const target=new URL(raw,window.location.origin);
    if(target.origin!==window.location.origin||!target.pathname.endsWith(".html"))return "home.html";
    if(["/auth.html","/login.html","/forgot-password.html"].includes(target.pathname))return "home.html";
    return target.pathname.replace(/^\//,"")+target.search+target.hash;
  }catch{return "home.html";}
}
function withTimeout(promise,ms,label){
  return Promise.race([
    promise,
    new Promise((_,reject)=>window.setTimeout(()=>reject(Object.assign(new Error(label),{code:"auth/timeout"})),ms))
  ]);
}
function friendlyError(error){
  const messages={"auth/internal-error":"Google sign-in could not finish in this browser. Please try again.","auth/web-storage-unsupported":"This browser is blocking secure sign-in storage. Please allow site storage for Vivid Cinema and try again.","auth/cancelled-popup-request":"Another Google sign-in is already in progress. Please try again.","auth/popup-closed-by-user":"Google sign-in was cancelled.","auth/email-already-in-use":"An account already exists for this email.","auth/invalid-email":"Please enter a valid email address.","auth/weak-password":"Choose a stronger password.","auth/invalid-credential":"Email or password is incorrect.","auth/user-disabled":"This account has been disabled.","auth/too-many-requests":"Too many attempts. Please wait and try again.","auth/popup-blocked":"Your browser blocked the Google sign-in window. Allow pop-ups for Vivid Cinema, then try again.","auth/account-exists-with-different-credential":"An account already exists with a different sign-in method.","auth/network-request-failed":"Connection problem. Check your internet connection and try again.","auth/requires-recent-login":"For security, please sign in again and retry.","auth/timeout":"Firebase sign-in is taking too long. Check your connection and try again."};
  if(error?.code==="auth/unauthorized-domain") return "Google sign-in is not enabled for this Vivid domain yet.";
  if(error?.code==="auth/operation-not-allowed") return "Google sign-in is currently disabled. Please use email and password for now.";
  return messages[error?.code]||"Something went wrong. Please try again.";
}
async function createUserRecord(user,name){
  await setDoc(doc(db,"users",user.uid),{displayName:name,email:user.email||null,provider:user.providerData?.[0]?.providerId||"password",updatedAt:serverTimestamp(),createdAt:serverTimestamp()},{merge:true});
}
let googleFinishPromise=null;
async function finishGoogleSignIn(credential){
  if(!credential?.user)return;
  if(googleFinishPromise)return googleFinishPromise;
  googleFinishPromise=(async()=>{
    try{await withTimeout(createUserRecord(credential.user,credential.user.displayName||""),7000,"Google profile sync timed out.");}
    catch(error){console.warn("Google sign-in succeeded but profile sync failed:",error);}
    void startLibrarySync();
    window.location.replace(postAuthDestination());
  })();
  return googleFinishPromise;
}
async function googleSignIn(){
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:"select_account"});
  // Prefer a popup on every device. Mobile browsers can return from a
  // redirect before Firebase has restored the credential, which can make the
  // UI immediately look signed out. Only fall back to redirect when the popup
  // is actually blocked/unavailable.
  try{
    const credential=await withTimeout(signInWithPopup(auth,provider),45000,"Google sign-in timed out.");
    await finishGoogleSignIn(credential);
    return;
  }catch(error){
    if(error?.code!=="auth/popup-blocked" && error?.code!=="auth/operation-not-supported-in-this-environment") throw error;
    try{localStorage.setItem("vivid:google-redirect","1");sessionStorage.setItem("vivid:google-redirect","1");}catch{}
    await signInWithRedirect(auth,provider);
  }
}
async function finishPendingGoogleRedirect(){
  let pending=false;
  try{
    pending=localStorage.getItem("vivid:google-redirect")==="1" || sessionStorage.getItem("vivid:google-redirect")==="1";
  }catch{}

  // On iOS/Safari, Firebase can restore the redirected Google user through
  // auth state while getRedirectResult() is empty. Keep both paths alive.
  const statePromise=new Promise(resolve=>{
    let settled=false;
    let unsubscribe=()=>{};
    const finish=()=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      try{unsubscribe();}catch{}
      resolve();
    };
    const timer=window.setTimeout(finish,10000);
    unsubscribe=onAuthStateChanged(auth,user=>{
      if(!user)return;
      try{
        localStorage.removeItem("vivid:google-redirect");
        sessionStorage.removeItem("vivid:google-redirect");
      }catch{}
      void finishGoogleSignIn({user}).finally(finish);
    });
  });

  try{
    const result=await withTimeout(getRedirectResult(auth),30000,"Google sign-in redirect timed out.");
    if(result?.user){
      try{
        localStorage.removeItem("vivid:google-redirect");
        sessionStorage.removeItem("vivid:google-redirect");
      }catch{}
      await finishGoogleSignIn(result);
      return;
    }
    if(auth.currentUser){
      await finishGoogleSignIn({user:auth.currentUser});
      return;
    }
    if(pending) await statePromise;
  }catch(error){
    console.error("Google redirect sign-in failed:",error);
    if(error?.code!=="auth/timeout")showMessage(friendlyError(error));
  }
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
    const credential=await withTimeout(createUserWithEmailAndPassword(auth,email,password),15000,"Account creation timed out.");
    if(name)await withTimeout(updateProfile(credential.user,{displayName:name}),10000,"Profile update timed out.");
    try{await withTimeout(createUserRecord(credential.user,name),10000,"Profile sync timed out.");}
    catch(profileError){console.warn("Profile sync skipped after account creation:",profileError);}
    await withTimeout(sendEmailVerification(credential.user),15000,"Verification email request timed out.");
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
    const credential=await withTimeout(signInWithEmailAndPassword(auth,email,password),15000,"Email sign-in timed out.");
    if(!credential.user.emailVerified){await signOut(auth);showMessage("Please verify your email before signing in. Check your inbox.");button.disabled=false;return;}
    void startLibrarySync();
    window.location.href=postAuthDestination();
  }catch(error){console.error(error);showMessage(friendlyError(error));button.disabled=false;}
});
document.getElementById("resend-verification")?.addEventListener("click",async()=>{
  const email=document.getElementById("login-email")?.value.trim()||"";
  const password=document.getElementById("login-password")?.value||"";
  const button=document.getElementById("resend-verification");
  if(!email||!password){showMessage("Enter your email and password first.");return;}
  button.disabled=true;showMessage("Sending verification email…",true);
  try{
    const credential=await withTimeout(signInWithEmailAndPassword(auth,email,password),15000,"Verification sign-in timed out.");
    if(credential.user.emailVerified) showMessage("Your email is already verified. You can log in normally.",true);
    else{await withTimeout(sendEmailVerification(credential.user),15000,"Verification email request timed out.");showMessage("Verification email sent. Check your inbox and spam folder.",true);}
    await signOut(auth);
  }catch(error){console.error(error);showMessage(friendlyError(error));}
  finally{button.disabled=false;}
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

void finishPendingGoogleRedirect();
