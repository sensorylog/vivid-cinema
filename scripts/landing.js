import { getFeaturedMovies } from "./content.js";
import { getImageUrl } from "./media.js";
import { auth, db } from "./firebase.js";
import { GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { doc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

const $=(id)=>document.getElementById(id);
const message=$("landing-message");
function setMessage(text,good=false){if(!message)return;message.textContent=text;message.style.color=good?"#9be7ad":"#ff9c9c"}
function rememberEmail(email){try{sessionStorage.setItem("vivid:signup-email",email)}catch{};window.location.href="auth.html"}
function wireForms(){
 document.querySelectorAll("[data-landing-email-form]").forEach(form=>form.addEventListener("submit",e=>{e.preventDefault();const input=form.querySelector("input[type=email]"),email=input?.value.trim()||"";if(!email||!input?.checkValidity()){setMessage("Enter a valid email address.");input?.focus();return}rememberEmail(email)}));
 document.querySelectorAll("[data-google-start]").forEach(button=>button.addEventListener("click",async()=>{button.disabled=true;setMessage("Connecting to Google…",true);try{const credential=await signInWithPopup(auth,new GoogleAuthProvider());await setDoc(doc(db,"users",credential.user.uid),{displayName:credential.user.displayName||"",email:credential.user.email||null,provider:credential.user.providerData?.[0]?.providerId||"google.com",updatedAt:serverTimestamp(),createdAt:serverTimestamp()},{merge:true});window.location.href="home.html"}catch(error){console.error(error);setMessage(error?.code==="auth/popup-blocked"?"Your browser blocked the Google window. Allow popups and try again.":error?.code==="auth/popup-closed-by-user"?"Google sign-in was cancelled.":"Google sign-in could not be completed. Try email instead.");button.disabled=false}}));
}
async function loadTrending(){
 const rail=$("landing-trending");if(!rail)return;
 try{
  const items=(await getFeaturedMovies(6)).filter(x=>x.poster_path||x.backdrop_path);
  rail.innerHTML=items.map((item,i)=>'<a class="landing-poster" href="title.html?id='+encodeURIComponent(item.id)+'&type='+encodeURIComponent(item.media_type||"movie")+'"><img src="'+getImageUrl(item.poster_path||item.backdrop_path,"w342")+'" alt="'+String(item.title||"Title").replace(/&/g,"&amp;").replace(/</g,"&lt;")+'" loading="lazy" decoding="async"><span class="landing-rank">'+(i+1)+'</span><span class="landing-poster-title">'+String(item.title||"Untitled").replace(/&/g,"&amp;").replace(/</g,"&lt;")+'</span></a>').join("");
  const backdrops=items.filter(x=>x.backdrop_path).slice(0,4);const layer=$("landing-backdrops");
  backdrops.forEach((item,i)=>{const div=document.createElement("div");div.className="landing-backdrop";div.style.backgroundImage="url(\""+getImageUrl(item.backdrop_path,"w1280")+"\")";div.setAttribute("aria-hidden","true");if(i===0)div.classList.add("is-visible");layer.appendChild(div)});
  const stack=$("landing-hero-stack");
  if(stack){
    stack.innerHTML=items.slice(0,3).map(item=>'<a class="landing-stack-poster" href="title.html?id='+encodeURIComponent(item.id)+'&type=movie"><img src="'+getImageUrl(item.poster_path||item.backdrop_path,"w500")+'" alt="" loading="eager"></a>').join("");
  }
  if(backdrops.length>1){let i=0;window.setInterval(()=>{const layers=layer.querySelectorAll(".landing-backdrop");layers[i]?.classList.remove("is-visible");i=(i+1)%layers.length;layers[i]?.classList.add("is-visible")},7000)}

 }catch(error){console.warn("Landing discovery unavailable:",error)}
}
function wireFaq(){document.querySelectorAll(".landing-faq-q").forEach(button=>button.addEventListener("click",()=>{const item=button.closest(".landing-faq-item");const open=item.classList.toggle("is-open");button.setAttribute("aria-expanded",String(open))}))}
wireForms();wireFaq();void loadTrending();
