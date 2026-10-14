const VIVID_LANG_KEY = "vivid-language";
const LANGUAGES = [
  ["en","English"],["fr","Français"],["es","Español"],["de","Deutsch"],
  ["pt","Português"],["it","Italiano"],["ja","日本語"],["ko","한국어"]
];

// Shared UI translations. Movie titles and user-generated/catalogue data are not
// translated here; those should retain their provider-supplied language.
const T = {
en: {
"Home":"Home","Discover":"Discover","Browse":"Browse","Trending":"Trending","Movies":"Movies","TV":"TV","Series":"Series","My Library":"My Library","Library":"Library","Sign in":"Sign in","Log in":"Log in","Log In":"Log In","Create Account":"Create Account","Create a free Vivid Cinema account and keep your library across devices.":"Create a free Vivid Cinema account and keep your library across devices.","Search":"Search","Search Vivid Cinema":"Search Vivid Cinema","Watch":"Watch","Details":"Details","Featured":"Featured","Trending now":"Trending now","Popular this week.":"Popular this week.","Now playing":"Now playing","In cinemas now.":"In cinemas now.","Popular movies":"Popular movies","Worth a watch.":"Worth a watch.","Top rated":"Top rated","Fan favourites.":"Fan favourites.","Popular TV":"Popular TV","Series to watch.":"Series to watch.","Coming soon":"Coming soon","See all":"See all","Load more":"Load more","Explore":"Explore","Language":"Language","Back":"Back","Account":"Account","News":"News","Live":"Live","Terms":"Terms","Privacy":"Privacy","Contact":"Contact","About":"About","Help & FAQ":"Help & FAQ","Accessibility":"Accessibility","Cookie Policy":"Cookie Policy","Name":"Name","Email":"Email","Password (6+ characters)":"Password (6+ characters)","Show":"Show","Hide":"Hide","Continue with Google":"Continue with Google","Already have an account?":"Already have an account?","Don't have an account?":"Don't have an account?","Create one":"Create one","Forgot password?":"Forgot password?","Resend verification email":"Resend verification email","or":"or","Loading…":"Loading…","Loading...":"Loading...","Retry":"Retry","Cancel":"Cancel","Save":"Save","Settings":"Settings","Language settings":"Language settings","No results found":"No results found","Clear":"Clear","Close":"Close","Submit":"Submit","Send":"Send","Next":"Next","Previous":"Previous","Play":"Play","Pause":"Pause","Episodes":"Episodes","Seasons":"Seasons","Overview":"Overview","Cast":"Cast","Similar titles":"Similar titles","Release date":"Release date","Genres":"Genres","Rating":"Rating","Duration":"Duration","Watch now":"Watch now","Add to library":"Add to library","Remove from library":"Remove from library","Continue watching":"Continue watching","Your library is empty":"Your library is empty","Something went wrong. Please try again.":"Something went wrong. Please try again."
},
fr: {
"Home":"Accueil","Discover":"Découvrir","Browse":"Parcourir","Trending":"Tendances","Movies":"Films","TV":"TV","Series":"Séries","My Library":"Ma bibliothèque","Library":"Bibliothèque","Sign in":"Se connecter","Log in":"Se connecter","Log In":"Connexion","Create Account":"Créer un compte","Create a free Vivid Cinema account and keep your library across devices.":"Créez un compte Vivid Cinema gratuit et retrouvez votre bibliothèque sur tous vos appareils.","Search":"Rechercher","Search Vivid Cinema":"Rechercher sur Vivid Cinema","Watch":"Regarder","Details":"Détails","Featured":"À la une","Trending now":"Tendances actuelles","Popular this week.":"Populaires cette semaine.","Now playing":"À l'affiche","In cinemas now.":"Actuellement au cinéma.","Popular movies":"Films populaires","Worth a watch.":"À découvrir.","Top rated":"Les mieux notés","Fan favourites.":"Les favoris du public.","Popular TV":"Séries populaires","Series to watch.":"Séries à regarder.","Coming soon":"Bientôt","See all":"Tout voir","Load more":"Afficher plus","Explore":"Explorer","Language":"Langue","Back":"Retour","Account":"Compte","News":"Actualités","Live":"En direct","Terms":"Conditions","Privacy":"Confidentialité","Contact":"Contact","About":"À propos","Help & FAQ":"Aide et FAQ","Accessibility":"Accessibilité","Cookie Policy":"Politique relative aux cookies","Name":"Nom","Email":"E-mail","Password (6+ characters)":"Mot de passe (6 caractères ou plus)","Show":"Afficher","Hide":"Masquer","Continue with Google":"Continuer avec Google","Already have an account?":"Vous avez déjà un compte ?","Don't have an account?":"Vous n'avez pas de compte ?","Create one":"En créer un","Forgot password?":"Mot de passe oublié ?","Resend verification email":"Renvoyer l'e-mail de vérification","or":"ou","Loading…":"Chargement…","Loading...":"Chargement…","Retry":"Réessayer","Cancel":"Annuler","Save":"Enregistrer","Settings":"Paramètres","Language settings":"Paramètres de langue","No results found":"Aucun résultat trouvé","Clear":"Effacer","Close":"Fermer","Submit":"Envoyer","Send":"Envoyer","Next":"Suivant","Previous":"Précédent","Play":"Lire","Pause":"Pause","Episodes":"Épisodes","Seasons":"Saisons","Overview":"Synopsis","Cast":"Distribution","Similar titles":"Titres similaires","Release date":"Date de sortie","Genres":"Genres","Rating":"Note","Duration":"Durée","Watch now":"Regarder","Add to library":"Ajouter à la bibliothèque","Remove from library":"Retirer de la bibliothèque","Continue watching":"Reprendre la lecture","Your library is empty":"Votre bibliothèque est vide","Something went wrong. Please try again.":"Une erreur s'est produite. Veuillez réessayer."
},
es: {
"Home":"Inicio","Discover":"Descubrir","Browse":"Explorar","Trending":"Tendencias","Movies":"Películas","TV":"TV","Series":"Series","My Library":"Mi biblioteca","Library":"Biblioteca","Sign in":"Iniciar sesión","Log in":"Iniciar sesión","Log In":"Iniciar sesión","Create Account":"Crear cuenta","Create a free Vivid Cinema account and keep your library across devices.":"Crea una cuenta gratuita de Vivid Cinema y conserva tu biblioteca en todos tus dispositivos.","Search":"Buscar","Search Vivid Cinema":"Buscar en Vivid Cinema","Watch":"Ver","Details":"Detalles","Featured":"Destacado","Trending now":"Tendencias actuales","Popular this week.":"Popular esta semana.","Now playing":"En cartelera","In cinemas now.":"Ahora en cines.","Popular movies":"Películas populares","Worth a watch.":"Merece la pena verla.","Top rated":"Mejor valoradas","Fan favourites.":"Favoritas del público.","Popular TV":"Series populares","Series to watch.":"Series para ver.","Coming soon":"Próximamente","See all":"Ver todo","Load more":"Cargar más","Explore":"Explorar","Language":"Idioma","Back":"Volver","Account":"Cuenta","News":"Noticias","Live":"En directo","Terms":"Términos","Privacy":"Privacidad","Contact":"Contacto","About":"Acerca de","Help & FAQ":"Ayuda y preguntas frecuentes","Accessibility":"Accesibilidad","Cookie Policy":"Política de cookies","Name":"Nombre","Email":"Correo electrónico","Password (6+ characters)":"Contraseña (6 caracteres o más)","Show":"Mostrar","Hide":"Ocultar","Continue with Google":"Continuar con Google","Already have an account?":"¿Ya tienes una cuenta?","Don't have an account?":"¿No tienes una cuenta?","Create one":"Crear una","Forgot password?":"¿Olvidaste tu contraseña?","Resend verification email":"Reenviar correo de verificación","or":"o","Loading…":"Cargando…","Loading...":"Cargando…","Retry":"Reintentar","Cancel":"Cancelar","Save":"Guardar","Settings":"Configuración","Language settings":"Configuración de idioma","No results found":"No se encontraron resultados","Clear":"Borrar","Close":"Cerrar","Submit":"Enviar","Send":"Enviar","Next":"Siguiente","Previous":"Anterior","Play":"Reproducir","Pause":"Pausar","Episodes":"Episodios","Seasons":"Temporadas","Overview":"Sinopsis","Cast":"Reparto","Similar titles":"Títulos similares","Release date":"Fecha de estreno","Genres":"Géneros","Rating":"Calificación","Duration":"Duración","Watch now":"Ver ahora","Add to library":"Añadir a la biblioteca","Remove from library":"Quitar de la biblioteca","Continue watching":"Seguir viendo","Your library is empty":"Tu biblioteca está vacía","Something went wrong. Please try again.":"Algo salió mal. Inténtalo de nuevo."
},
de: {
"Home":"Startseite","Discover":"Entdecken","Browse":"Durchsuchen","Trending":"Im Trend","Movies":"Filme","TV":"TV","Series":"Serien","My Library":"Meine Bibliothek","Library":"Bibliothek","Sign in":"Anmelden","Log in":"Anmelden","Log In":"Anmelden","Create Account":"Konto erstellen","Create a free Vivid Cinema account and keep your library across devices.":"Erstelle ein kostenloses Vivid-Cinema-Konto und nutze deine Bibliothek auf allen Geräten.","Search":"Suchen","Search Vivid Cinema":"Vivid Cinema durchsuchen","Watch":"Ansehen","Details":"Details","Featured":"Empfohlen","Trending now":"Aktuell im Trend","Popular this week.":"Diese Woche beliebt.","Now playing":"Aktuell im Kino","In cinemas now.":"Jetzt im Kino.","Popular movies":"Beliebte Filme","Worth a watch.":"Sehenswert.","Top rated":"Bestbewertet","Fan favourites.":"Publikumsfavoriten.","Popular TV":"Beliebte Serien","Series to watch.":"Serien zum Anschauen.","Coming soon":"Demnächst","See all":"Alle ansehen","Load more":"Mehr laden","Explore":"Entdecken","Language":"Sprache","Back":"Zurück","Account":"Konto","News":"Nachrichten","Live":"Live","Terms":"Nutzungsbedingungen","Privacy":"Datenschutz","Contact":"Kontakt","About":"Über uns","Help & FAQ":"Hilfe & FAQ","Accessibility":"Barrierefreiheit","Cookie Policy":"Cookie-Richtlinie","Name":"Name","Email":"E-Mail","Password (6+ characters)":"Passwort (mindestens 6 Zeichen)","Show":"Anzeigen","Hide":"Ausblenden","Continue with Google":"Mit Google fortfahren","Already have an account?":"Du hast bereits ein Konto?","Don't have an account?":"Du hast noch kein Konto?","Create one":"Konto erstellen","Forgot password?":"Passwort vergessen?","Resend verification email":"Bestätigungs-E-Mail erneut senden","or":"oder","Loading…":"Wird geladen…","Loading...":"Wird geladen…","Retry":"Erneut versuchen","Cancel":"Abbrechen","Save":"Speichern","Settings":"Einstellungen","Language settings":"Spracheinstellungen","No results found":"Keine Ergebnisse gefunden","Clear":"Leeren","Close":"Schließen","Submit":"Absenden","Send":"Senden","Next":"Weiter","Previous":"Zurück","Play":"Abspielen","Pause":"Pause","Episodes":"Folgen","Seasons":"Staffeln","Overview":"Übersicht","Cast":"Besetzung","Similar titles":"Ähnliche Titel","Release date":"Veröffentlichungsdatum","Genres":"Genres","Rating":"Bewertung","Duration":"Dauer","Watch now":"Jetzt ansehen","Add to library":"Zur Bibliothek hinzufügen","Remove from library":"Aus Bibliothek entfernen","Continue watching":"Weiterschauen","Your library is empty":"Deine Bibliothek ist leer","Something went wrong. Please try again.":"Ein Fehler ist aufgetreten. Bitte versuche es erneut."
},
pt: {
"Home":"Início","Discover":"Descobrir","Browse":"Explorar","Trending":"Em alta","Movies":"Filmes","TV":"TV","Series":"Séries","My Library":"Minha biblioteca","Library":"Biblioteca","Sign in":"Entrar","Log in":"Entrar","Log In":"Entrar","Create Account":"Criar conta","Create a free Vivid Cinema account and keep your library across devices.":"Crie uma conta gratuita no Vivid Cinema e mantenha a sua biblioteca em todos os dispositivos.","Search":"Pesquisar","Search Vivid Cinema":"Pesquisar no Vivid Cinema","Watch":"Assistir","Details":"Detalhes","Featured":"Em destaque","Trending now":"Em alta agora","Popular this week.":"Populares esta semana.","Now playing":"Em cartaz","In cinemas now.":"Nos cinemas agora.","Popular movies":"Filmes populares","Worth a watch.":"Vale a pena assistir.","Top rated":"Mais bem avaliados","Fan favourites.":"Favoritos do público.","Popular TV":"Séries populares","Series to watch.":"Séries para assistir.","Coming soon":"Em breve","See all":"Ver tudo","Load more":"Carregar mais","Explore":"Explorar","Language":"Idioma","Back":"Voltar","Account":"Conta","News":"Notícias","Live":"Ao vivo","Terms":"Termos","Privacy":"Privacidade","Contact":"Contato","About":"Sobre","Help & FAQ":"Ajuda e FAQ","Accessibility":"Acessibilidade","Cookie Policy":"Política de cookies","Name":"Nome","Email":"E-mail","Password (6+ characters)":"Senha (6 caracteres ou mais)","Show":"Mostrar","Hide":"Ocultar","Continue with Google":"Continuar com o Google","Already have an account?":"Já tem uma conta?","Don't have an account?":"Ainda não tem uma conta?","Create one":"Criar conta","Forgot password?":"Esqueceu a senha?","Resend verification email":"Reenviar e-mail de verificação","or":"ou","Loading…":"A carregar…","Loading...":"A carregar…","Retry":"Tentar novamente","Cancel":"Cancelar","Save":"Guardar","Settings":"Definições","Language settings":"Definições de idioma","No results found":"Não foram encontrados resultados","Clear":"Limpar","Close":"Fechar","Submit":"Enviar","Send":"Enviar","Next":"Seguinte","Previous":"Anterior","Play":"Reproduzir","Pause":"Pausar","Episodes":"Episódios","Seasons":"Temporadas","Overview":"Visão geral","Cast":"Elenco","Similar titles":"Títulos semelhantes","Release date":"Data de lançamento","Genres":"Géneros","Rating":"Classificação","Duration":"Duração","Watch now":"Ver agora","Add to library":"Adicionar à biblioteca","Remove from library":"Remover da biblioteca","Continue watching":"Continuar a ver","Your library is empty":"A sua biblioteca está vazia","Something went wrong. Please try again.":"Ocorreu um erro. Tente novamente."
},
it: {
"Home":"Home","Discover":"Scopri","Browse":"Esplora","Trending":"Tendenze","Movies":"Film","TV":"TV","Series":"Serie","My Library":"La mia libreria","Library":"Libreria","Sign in":"Accedi","Log in":"Accedi","Log In":"Accedi","Create Account":"Crea account","Create a free Vivid Cinema account and keep your library across devices.":"Crea un account Vivid Cinema gratuito e conserva la tua libreria su tutti i dispositivi.","Search":"Cerca","Search Vivid Cinema":"Cerca su Vivid Cinema","Watch":"Guarda","Details":"Dettagli","Featured":"In evidenza","Trending now":"Tendenze del momento","Popular this week.":"Popolari questa settimana.","Now playing":"Al cinema","In cinemas now.":"Ora al cinema.","Popular movies":"Film popolari","Worth a watch.":"Da vedere.","Top rated":"Più votati","Fan favourites.":"I preferiti del pubblico.","Popular TV":"Serie popolari","Series to watch.":"Serie da guardare.","Coming soon":"Prossimamente","See all":"Vedi tutto","Load more":"Carica altro","Explore":"Esplora","Language":"Lingua","Back":"Indietro","Account":"Account","News":"Notizie","Live":"In diretta","Terms":"Termini","Privacy":"Privacy","Contact":"Contatti","About":"Chi siamo","Help & FAQ":"Aiuto e FAQ","Accessibility":"Accessibilità","Cookie Policy":"Informativa sui cookie","Name":"Nome","Email":"E-mail","Password (6+ characters)":"Password (almeno 6 caratteri)","Show":"Mostra","Hide":"Nascondi","Continue with Google":"Continua con Google","Already have an account?":"Hai già un account?","Don't have an account?":"Non hai un account?","Create one":"Creane uno","Forgot password?":"Password dimenticata?","Resend verification email":"Invia di nuovo l'e-mail di verifica","or":"oppure","Loading…":"Caricamento…","Loading...":"Caricamento…","Retry":"Riprova","Cancel":"Annulla","Save":"Salva","Settings":"Impostazioni","Language settings":"Impostazioni lingua","No results found":"Nessun risultato trovato","Clear":"Cancella","Close":"Chiudi","Submit":"Invia","Send":"Invia","Next":"Avanti","Previous":"Precedente","Play":"Riproduci","Pause":"Pausa","Episodes":"Episodi","Seasons":"Stagioni","Overview":"Panoramica","Cast":"Cast","Similar titles":"Titoli simili","Release date":"Data di uscita","Genres":"Generi","Rating":"Valutazione","Duration":"Durata","Watch now":"Guarda ora","Add to library":"Aggiungi alla libreria","Remove from library":"Rimuovi dalla libreria","Continue watching":"Continua a guardare","Your library is empty":"La tua libreria è vuota","Something went wrong. Please try again.":"Si è verificato un errore. Riprova."
},
ja: {
"Home":"ホーム","Discover":"見つける","Browse":"閲覧","Trending":"トレンド","Movies":"映画","TV":"TV","Series":"シリーズ","My Library":"マイライブラリ","Library":"ライブラリ","Sign in":"サインイン","Log in":"ログイン","Log In":"ログイン","Create Account":"アカウント作成","Create a free Vivid Cinema account and keep your library across devices.":"無料のVivid Cinemaアカウントを作成して、すべてのデバイスでライブラリを利用しましょう。","Search":"検索","Search Vivid Cinema":"Vivid Cinemaを検索","Watch":"視聴","Details":"詳細","Featured":"注目","Trending now":"トレンド","Popular this week.":"今週の人気作品。","Now playing":"上映中","In cinemas now.":"現在劇場公開中。","Popular movies":"人気映画","Worth a watch.":"おすすめ作品。","Top rated":"高評価","Fan favourites.":"人気作品。","Popular TV":"人気シリーズ","Series to watch.":"おすすめシリーズ。","Coming soon":"近日公開","See all":"すべて見る","Load more":"さらに読み込む","Explore":"探す","Language":"言語","Back":"戻る","Account":"アカウント","News":"ニュース","Live":"ライブ","Terms":"利用規約","Privacy":"プライバシー","Contact":"お問い合わせ","About":"概要","Help & FAQ":"ヘルプ・FAQ","Accessibility":"アクセシビリティ","Cookie Policy":"Cookieポリシー","Name":"名前","Email":"メールアドレス","Password (6+ characters)":"パスワード（6文字以上）","Show":"表示","Hide":"非表示","Continue with Google":"Googleで続行","Already have an account?":"すでにアカウントをお持ちですか？","Don't have an account?":"アカウントをお持ちでないですか？","Create one":"作成する","Forgot password?":"パスワードをお忘れですか？","Resend verification email":"確認メールを再送信","or":"または","Loading…":"読み込み中…","Loading...":"読み込み中…","Retry":"再試行","Cancel":"キャンセル","Save":"保存","Settings":"設定","Language settings":"言語設定","No results found":"結果が見つかりません","Clear":"クリア","Close":"閉じる","Submit":"送信","Send":"送信","Next":"次へ","Previous":"前へ","Play":"再生","Pause":"一時停止","Episodes":"エピソード","Seasons":"シーズン","Overview":"概要","Cast":"キャスト","Similar titles":"類似作品","Release date":"公開日","Genres":"ジャンル","Rating":"評価","Duration":"再生時間","Watch now":"今すぐ見る","Add to library":"ライブラリに追加","Remove from library":"ライブラリから削除","Continue watching":"視聴を続ける","Your library is empty":"ライブラリは空です","Something went wrong. Please try again.":"エラーが発生しました。もう一度お試しください。"
},
ko: {
"Home":"홈","Discover":"둘러보기","Browse":"탐색","Trending":"인기 급상승","Movies":"영화","TV":"TV","Series":"시리즈","My Library":"내 라이브러리","Library":"라이브러리","Sign in":"로그인","Log in":"로그인","Log In":"로그인","Create Account":"계정 만들기","Create a free Vivid Cinema account and keep your library across devices.":"무료 Vivid Cinema 계정을 만들고 모든 기기에서 라이브러리를 이용하세요.","Search":"검색","Search Vivid Cinema":"Vivid Cinema 검색","Watch":"시청","Details":"상세 정보","Featured":"추천","Trending now":"현재 인기","Popular this week.":"이번 주 인기 작품.","Now playing":"현재 상영 중","In cinemas now.":"현재 극장 상영 중.","Popular movies":"인기 영화","Worth a watch.":"추천 작품.","Top rated":"평점 높은 작품","Fan favourites.":"인기 작품.","Popular TV":"인기 시리즈","Series to watch.":"추천 시리즈.","Coming soon":"공개 예정","See all":"모두 보기","Load more":"더 보기","Explore":"탐색","Language":"언어","Back":"뒤로","Account":"계정","News":"뉴스","Live":"라이브","Terms":"이용약관","Privacy":"개인정보 보호","Contact":"문의","About":"소개","Help & FAQ":"도움말 및 FAQ","Accessibility":"접근성","Cookie Policy":"쿠키 정책","Name":"이름","Email":"이메일","Password (6+ characters)":"비밀번호(6자 이상)","Show":"표시","Hide":"숨기기","Continue with Google":"Google로 계속하기","Already have an account?":"이미 계정이 있나요?","Don't have an account?":"계정이 없나요?","Create one":"계정 만들기","Forgot password?":"비밀번호를 잊으셨나요?","Resend verification email":"인증 이메일 다시 보내기","or":"또는","Loading…":"불러오는 중…","Loading...":"불러오는 중…","Retry":"다시 시도","Cancel":"취소","Save":"저장","Settings":"설정","Language settings":"언어 설정","No results found":"검색 결과가 없습니다","Clear":"지우기","Close":"닫기","Submit":"제출","Send":"보내기","Next":"다음","Previous":"이전","Play":"재생","Pause":"일시정지","Episodes":"에피소드","Seasons":"시즌","Overview":"개요","Cast":"출연진","Similar titles":"비슷한 작품","Release date":"개봉일","Genres":"장르","Rating":"평점","Duration":"재생 시간","Watch now":"지금 시청","Add to library":"라이브러리에 추가","Remove from library":"라이브러리에서 삭제","Continue watching":"이어서 시청","Your library is empty":"라이브러리가 비어 있습니다","Something went wrong. Please try again.":"문제가 발생했습니다. 다시 시도해 주세요."
}
};

const FOOTER = [["terms.html","Terms"],["privacy.html","Privacy"],["contact.html","Contact"],["about.html","About"],["help.html","Help & FAQ"],["accessibility.html","Accessibility"],["cookies.html","Cookie Policy"]];
const originalText = new WeakMap();
const originalAttrs = new WeakMap();
let currentLanguage = "en";
let translating = false;

function safeLanguage(value) { return T[value] ? value : "en"; }
function getLanguage() {
  try { return safeLanguage(localStorage.getItem(VIVID_LANG_KEY) || "en"); }
  catch { return "en"; }
}
function rememberText(node) {
  if (!originalText.has(node)) originalText.set(node, node.nodeValue);
  return originalText.get(node);
}
function translateValue(value, lang) {
  const dictionary = T[lang] || T.en;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const translated = dictionary[trimmed];
  if (translated === undefined) return value;
  return value.replace(trimmed, translated);
}
function translateTextNode(node, lang) {
  if (!node || node.nodeType !== Node.TEXT_NODE || !node.parentElement) return;
  if (node.parentElement.closest("script,style,code,pre,textarea,[data-i18n-skip],.vivid-brand-wordmark")) return;
  const source = rememberText(node);
  const translated = translateValue(source, lang);
  if (node.nodeValue !== translated) node.nodeValue = translated;
}
function translateElement(el, lang) {
  if (!(el instanceof Element) || el.matches("script,style,code,pre,[data-i18n-skip]")) return;
  const dictionary = T[lang] || T.en;
  if (el.hasAttribute("data-i18n")) {
    const key = el.getAttribute("data-i18n");
    if (dictionary[key] !== undefined) el.textContent = dictionary[key];
  }
  if (el.hasAttribute("placeholder") || el.hasAttribute("aria-label") || el.hasAttribute("title") || el.hasAttribute("alt")) {
    if (!originalAttrs.has(el)) originalAttrs.set(el, {});
    const saved = originalAttrs.get(el);
    for (const attr of ["placeholder","aria-label","title","alt"]) {
      if (!el.hasAttribute(attr)) continue;
      if (!(attr in saved)) saved[attr] = el.getAttribute(attr);
      const source = saved[attr];
      const translated = dictionary[source];
      if (translated !== undefined) el.setAttribute(attr, translated);
    }
  }
  if (el instanceof HTMLInputElement && ["button","submit","reset"].includes(el.type)) {
    if (!originalAttrs.has(el)) originalAttrs.set(el, {});
    const saved = originalAttrs.get(el);
    if (!("value" in saved)) saved.value = el.value;
    if (dictionary[saved.value] !== undefined) el.value = dictionary[saved.value];
  }
}
function translateDocument(lang) {
  currentLanguage = safeLanguage(lang);
  const root = document.documentElement;
  root.lang = currentLanguage;
  root.dataset.vividLanguage = currentLanguage;
  translating = true;
  const walker = document.createTreeWalker(document.body || root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) translateTextNode(node, currentLanguage);
  (document.body || root).querySelectorAll("*").forEach(el => translateElement(el, currentLanguage));
  document.querySelectorAll(".vivid-language select").forEach(select => {
    select.value = currentLanguage;
    select.setAttribute("aria-label", (T[currentLanguage] || T.en).Language);
  });
  document.querySelectorAll(".vivid-footer").forEach(footer => {
    const dict = T[currentLanguage] || T.en;
    const year = footer.querySelector(".vivid-footer-year")?.textContent || "© 2026 Vivid Cinema";
    footer.replaceChildren();
    const yearEl = document.createElement("span");
    yearEl.className = "vivid-footer-year";
    yearEl.textContent = year;
    const links = document.createElement("span");
    links.className = "vivid-footer-links";
    FOOTER.forEach(([href, key]) => {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = dict[key] || T.en[key];
      links.appendChild(a);
    });
    footer.append(yearEl, document.createTextNode(" · "), links);
  });
  translating = false;
  document.dispatchEvent(new CustomEvent("vivid:languagechange", { detail: { language: currentLanguage } }));
}
function setLanguage(lang) {
  const next = safeLanguage(lang);
  try { localStorage.setItem(VIVID_LANG_KEY, next); } catch {}
  translateDocument(next);
}
function addLanguagePicker() {
  let wrap = document.querySelector(".vivid-language");
  if (wrap?.querySelector("select")) {
    wrap.querySelector("select").value = getLanguage();
    return;
  }
  const lang = getLanguage();
  wrap = document.createElement("div");
  wrap.className = "vivid-language";
  const select = document.createElement("select");
  select.id = "vivid-language-select";
  select.setAttribute("aria-label", (T[lang] || T.en).Language);
  select.setAttribute("autocomplete", "off");
  LANGUAGES.forEach(([code, name]) => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = code.toUpperCase();
    option.title = name;
    option.selected = code === lang;
    select.appendChild(option);
  });
  select.addEventListener("change", () => setLanguage(select.value));
  wrap.appendChild(select);
  const slot = document.querySelector(".vivid-nav-language-slot");
  const nav = document.querySelector(".vivid-nav,.vivid-discovery-nav,.vivid-library-nav,.vivid-title-nav,.vivid-watch-nav,.landing-header,.nav");
  if (slot) slot.appendChild(wrap);
  else if (nav) nav.appendChild(wrap);
  else {
    wrap.style.cssText = "position:fixed;top:12px;right:14px;z-index:3000";
    document.body.appendChild(wrap);
  }
}
function addStyles() {
  if (document.getElementById("vivid-i18n-style")) return;
  const style = document.createElement("style");
  style.id = "vivid-i18n-style";
  style.textContent = ".vivid-language{position:relative;display:inline-flex;align-items:center;flex:0 0 auto}.vivid-language select{appearance:none;-webkit-appearance:none;height:36px;min-width:58px;padding:0 27px 0 10px;border:1px solid rgba(255,255,255,.11);border-radius:11px;background:rgba(255,255,255,.055);color:#f5f7fa;font:600 .72rem/1 inherit;letter-spacing:.04em;outline:0;cursor:pointer}.vivid-language select option{background:#11151c;color:#f5f7fa}.vivid-language:after{content:'⌄';position:absolute;right:9px;top:50%;transform:translateY(-52%);pointer-events:none;color:#9fa6b0;font-size:.72rem}.vivid-footer{display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap;text-align:center}.vivid-footer-links{display:flex;justify-content:center;gap:10px 14px;flex-wrap:wrap}.vivid-footer-links a{color:inherit}@media(max-width:700px){.vivid-language select{height:34px;min-width:54px}}";
  document.head.appendChild(style);
}
function initI18n() {
  addStyles();
  addLanguagePicker();
  translateDocument(getLanguage());
  // Translate labels inserted later by page scripts, including search, cards,
  // modal content and asynchronous UI. Avoid observing our own translation writes.
  const observer = new MutationObserver(records => {
    if (translating) return;
    for (const record of records) {
      if (record.type === "characterData") translateTextNode(record.target, currentLanguage);
      for (const node of record.addedNodes || []) {
        if (node.nodeType === Node.TEXT_NODE) translateTextNode(node, currentLanguage);
        else if (node.nodeType === Node.ELEMENT_NODE) {
          translateElement(node, currentLanguage);
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let textNode;
          while ((textNode = walker.nextNode())) translateTextNode(textNode, currentLanguage);
          node.querySelectorAll("*").forEach(el => translateElement(el, currentLanguage));
        }
      }
    }
  });
  observer.observe(document.body, {subtree:true, childList:true, characterData:true});
  document.addEventListener("vivid:languagechange", event => {
    document.querySelectorAll("[data-i18n]").forEach(el => translateElement(el, event.detail.language));
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initI18n, {once:true});
else initI18n();
