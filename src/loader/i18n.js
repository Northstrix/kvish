/* Kvish LOADER dictionary - tiny, standalone, parsed before anything else (the app's own `translations` only exist after the app has loaded).
   One pipe-separated string per language, 10 slots:
   0 label 1 "Loading the app"   1 label 2 "Please wait for a while"   2 "Ready" (only with ?noAutoReveal)   3 "Open app" button   4 "Retry" button
   5 no-WebGL message   6 "couldn't download {0}"   7 start-failed message   8 app name written as TEXT (empty = draw the Latin wordmark SVG)   9 text direction ("rtl" or empty)
   ADD A LANGUAGE: add one line with the same 10 slots, keyed by the same code the app uses for ?lang=. Unknown codes fall back to "en". */
window.KV_LD_I18N={
en:"Loading the app|Please wait for a while|Ready|Open app|Retry|Your browser doesn’t support WebGL, or it’s turned off. Kvish can’t run without it.|Couldn’t download {0}. Check your connection and try again.|Kvish couldn’t start.||",
he:"טוען את האפליקציה|אנא המתינו מעט|מוכן|פתחו את האפליקציה|נסו שוב|הדפדפן שלכם לא תומך ב-WebGL, או שהוא כבוי. כביש לא יכול לפעול בלעדיו.|לא ניתן להוריד את {0}. בדקו את החיבור ונסו שוב.|כביש לא הצליח להיפתח.|כביש|rtl",
it:"Caricamento dell’app|Attendi ancora un po’|Pronto|Apri app|Riprova|Il browser non supporta WebGL oppure è disattivato. Kvish non può funzionare senza.|Impossibile scaricare {0}. Controlla la connessione e riprova.|Kvish non è riuscito ad avviarsi.||",
es:"Cargando la app|Espera un momento|Listo|Abrir app|Reintentar|Tu navegador no admite WebGL o lo tiene desactivado. Kvish no puede funcionar sin él.|No se pudo descargar {0}. Revisa tu conexión e inténtalo de nuevo.|Kvish no pudo iniciarse.||",
de:"App wird geladen|Bitte warte einen Moment|Bereit|App öffnen|Erneut versuchen|Dein Browser unterstützt WebGL nicht oder hat es deaktiviert. Ohne WebGL kann Kvish nicht laufen.|{0} konnte nicht heruntergeladen werden. Prüfe deine Verbindung und versuche es erneut.|Kvish konnte nicht gestartet werden.||"
};
