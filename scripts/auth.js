import { auth, db } from "./firebase.js?v=20261016-auth-runtime-audit1";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  getAdditionalUserInfo,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { startLibrarySync } from "./library.js";
async function sendVividVerificationEmail() {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error("Please sign in and try again."), { code: "vivid/missing-user" });
  const token = await user.getIdToken();
  const response = await fetch("https://vivid-cinema-api.vercel.app/api/send-verification", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({}),
    credentials: "omit",
    cache: "no-store"
  });
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok || result.ok === false) {
    throw Object.assign(new Error(result.message || "We couldn't send the verification email right now."), {
      code: result.code || "vivid/email-service-error"
    });
  }
}

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
function setPostAuthNotice(message){
  try{sessionStorage.setItem("vivid:auth-success",message);}catch{}
}
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
  const messages={"auth/internal-error":"Google sign-in could not finish in this browser. Please try again.","auth/web-storage-unsupported":"This browser is blocking secure sign-in storage. Please allow site storage for Vivid Cinema and try again.","auth/cancelled-popup-request":"Another Google sign-in is already in progress. Please try again.","auth/popup-closed-by-user":"Google sign-in was cancelled.","auth/email-already-in-use":"An account already exists for this email.","auth/invalid-email":"Please enter a valid email address.","auth/weak-password":"Choose a stronger password.","auth/invalid-credential":"Email or password is incorrect.","auth/user-disabled":"This account has been disabled.","auth/too-many-requests":"Too many attempts. Please wait and try again.","auth/popup-blocked":"Your browser blocked the Google sign-in window. Allow pop-ups for Vivid Cinema, then try again.","auth/account-exists-with-different-credential":"An account already exists with a different sign-in method.","auth/network-request-failed":"Connection problem. Check your internet connection and try again.","auth/requires-recent-login":"For security, please sign in again and retry.","auth/timeout":"Firebase sign-in is taking too long. Check your connection and try again.","vivid/rate-limited":"Please wait a minute before requesting another verification email.","vivid/missing-user":"Please sign in and try again."};
  if(error?.code==="auth/unauthorized-domain") return "This Vivid domain is not authorized in Firebase Authentication.";
  if(error?.code==="auth/operation-not-allowed") return "This sign-in method is disabled in Firebase Authentication.";
  if(error?.code==="auth/api-key-not-valid" || error?.code==="auth/invalid-api-key") return "Firebase rejected this app's API key. Check the Firebase web app configuration.";
  if(error?.code==="auth/app-not-authorized" || error?.code==="auth/requests-to-this-api-are-blocked") return "Firebase blocked this app's API key or domain. Check the API key restrictions and Firebase Auth settings.";
  return messages[error?.code]||(`Sign-in failed (${error?.code||"unknown"}). Please try again.`);
}
async function createUserRecord(user,name){
  const profileRef=doc(db,"users",user.uid);
  const snapshot=await getDoc(profileRef);
  const profile={
    displayName:name||user.displayName||"",
    email:user.email||null,
    provider:(user.providerData||[]).some(item=>item.providerId==="google.com")?"google.com":"password",
    updatedAt:serverTimestamp()
  };
  // Preserve the original membership date when Google signs in again.
  if(!snapshot.exists()||!snapshot.data()?.createdAt)profile.createdAt=serverTimestamp();
  await setDoc(profileRef,profile,{merge:true});
}
let googleFinishPromise=null;
async function finishGoogleSignIn(credential){
  if(!credential?.user)return;
  if(googleFinishPromise)return googleFinishPromise;
  googleFinishPromise=(async()=>{
    try{await withTimeout(createUserRecord(credential.user,credential.user.displayName||""),7000,"Google profile sync timed out.");}
    catch(error){console.warn("Google sign-in succeeded but profile sync failed:",error);}
    void startLibrarySync();
    let details=null;
    try{details=getAdditionalUserInfo(credential);}catch{}
    setPostAuthNotice(details?.isNewUser?"Account created successfully with Google! Welcome to Vivid Cinema.":"Successfully signed in with Google! Welcome back.");
    window.location.replace(postAuthDestination());
  })();
  return googleFinishPromise;
}
async function googleSignIn(){
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:"select_account"});

  // Keep the popup call directly inside the click's user-activation window.
  // Redirect is only a fallback when this browser explicitly blocks popups.
  try{
    const credential=await withTimeout(signInWithPopup(auth,provider),45000,"Google sign-in timed out.");
    await finishGoogleSignIn(credential);
  }catch(error){
    const canFallback=error?.code==="auth/popup-blocked" ||
      error?.code==="auth/operation-not-supported-in-this-environment";
    if(!canFallback)throw error;
    try{localStorage.setItem("vivid:google-redirect","1");sessionStorage.setItem("vivid:google-redirect","1");}catch{}
    await signInWithRedirect(auth,provider);
  }
}
async function finishPendingGoogleRedirect(){
  let pending=false;
  try{
    pending=localStorage.getItem("vivid:google-redirect")==="1" || sessionStorage.getItem("vivid:google-redirect")==="1";
  }catch{}

  // Only inspect redirect results after this app explicitly started a redirect.
  // Avoid a competing redirect-result operation during ordinary sign-in.
  if(!pending)return;

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
    await withTimeout(sendVividVerificationEmail(),20000,"Verification email request timed out.");
    showMessage("Account created! Check your inbox for a Vivid Cinema email and tap Verify My Email.",true);
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
    setPostAuthNotice("Welcome back! You’ve successfully signed in.");
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
    else{await withTimeout(sendVividVerificationEmail(),20000,"Verification email request timed out.");showMessage("Your Vivid Cinema verification email is on its way. Check your inbox and spam folder.",true);}
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

// Only recover a redirect that this app explicitly initiated.
void finishPendingGoogleRedirect().catch(error=>{
  console.error("Vivid pending Google redirect recovery failed:",{code:error?.code||null,message:error?.message||String(error)});
  showMessage(friendlyError(error));
});
