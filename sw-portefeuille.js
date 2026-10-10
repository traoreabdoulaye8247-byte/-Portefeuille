// ============================================================
//  Mon Portefeuille — service worker   (fichier : sw-portefeuille.js)
//
//  IMPORTANT : ce fichier NE DOIT PAS s'appeler sw.js — FRIGO vit dans le même
//  dossier et possède déjà SON sw.js. Un seul fichier peut porter ce nom, et
//  celui qui reste écrase l'autre : l'appli perdante perd son hors-ligne.
//  Il est enregistré avec une portée limitée à portefeuille.html, pour que les
//  deux applis gardent chacune son service worker.
//  Rôle : garder une copie de l'appli dans le téléphone pour
//  qu'elle s'ouvre MÊME SANS INTERNET.
//
//  Stratégie : RÉSEAU D'ABORD.
//    - Avec Internet : on va toujours chercher la dernière version.
//      => une mise à jour arrive TOUJOURS, jamais de version figée.
//    - Sans Internet : on sert la copie gardée.
//
//  RÈGLES DE PRUDENCE (apprises en cassant des choses, v46 -> v47) :
//   1. On ne touche QU'À NOS PROPRES caches (préfixe 'portefeuille-').
//      D'autres applis vivent sur la même adresse (FRIGO) : effacer
//      leurs caches tuerait LEUR hors-ligne.
//   2. On ne garde QU'UNE SEULE copie par fichier : la clé du cache est
//      l'adresse SANS le ?v=NN. Sinon chaque déploiement laisse une copie
//      de plus, et c'est la PLUS VIEILLE qui serait servie hors ligne.
//   3. On n'intercepte QUE portefeuille.html et sw.js. Le reste de
//      l'adresse (dont FRIGO) passe sans qu'on y touche.
// ============================================================

var PREFIXE = 'portefeuille-';
var CACHE = PREFIXE + 'v2';
// Version que l'utilisateur a installée lui-même depuis un fichier de son téléphone.
// Elle PRIME sur celle du serveur, même avec Internet — c'est tout l'intérêt :
// plus besoin de passer par GitHub pour mettre l'appli à jour.
// Porte de secours : ouvrir l'adresse avec ?maj=reset efface cette version
// et fait revenir celle du serveur, même si la version installée est cassée.
var CACHE_MANUEL = PREFIXE + 'manuel';
var A_NOUS = ['portefeuille.html', 'sw-portefeuille.js'];

function nousConcerne(url) {
  var f = url.pathname.split('/').pop();
  return f === '' || f === 'index.html' || A_NOUS.indexOf(f) >= 0;
}

// Clé de cache = adresse SANS le ?v=NN : une seule copie, toujours la plus fraîche.
// L'adresse du dossier (.../) et .../index.html sont la MÊME page : même clé,
// sinon hors ligne l'une des deux ouvertures échouerait.
function cle(url) {
  var p = url.pathname;
  if (p.charAt(p.length - 1) === '/') p = p + 'index.html';
  return url.origin + p;
}

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (noms) {
        return Promise.all(noms.map(function (n) {
          // On n'efface QUE nos anciens caches. Ceux des autres applis
          // de la même adresse ne nous appartiennent pas.
          if (n === CACHE_MANUEL) return null;   // jamais : c'est sa version à lui
          if (n.indexOf(PREFIXE) === 0 && n !== CACHE) return caches.delete(n);
          return null;
        }));
      })
      .then(function () { return self.clients.claim(); })
      .catch(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  // Le vérificateur de mise à jour interroge avec cache:'no-store' : il veut la
  // VRAIE réponse du serveur, jamais notre copie. On s'écarte — ainsi, hors ligne,
  // il échoue franchement (« Pas de connexion ») au lieu de croire à tort être à jour.
  if (req.cache === 'no-store') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Autre adresse (polices Google, wa.me, cartes) : on laisse passer.
  if (url.origin !== self.location.origin) return;
  // Fichier qui n'est pas à nous (FRIGO, autres pages) : on laisse passer.
  if (!nousConcerne(url)) return;

  // Porte de secours : ?maj=reset efface la version installée à la main.
  // Traité ici, dans le service worker, pour que ça marche MÊME si la version
  // installée est cassée et n'arrive plus à s'exécuter.
  if (url.search.indexOf('maj=reset') >= 0) {
    e.respondWith(
      caches.delete(CACHE_MANUEL)
        .then(function () { return fetch(req); })
        .catch(function () { return caches.match(cle(url)); })
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE_MANUEL)
      .then(function (c) { return c.match(cle(url)); })
      .catch(function () { return null; })
      .then(function (manuel) {
        if (manuel) return manuel;     // sa version à lui gagne
        return reseauPuisCache(req, url);
      })
  );
});

function reseauPuisCache(req, url) {
  return (
    fetch(req)
      .then(function (rep) {
        if (rep && rep.status === 200 && rep.type === 'basic') {
          var copie = rep.clone();
          caches.open(CACHE)
            .then(function (c) { return c.put(cle(url), copie); })
            .catch(function () { /* cache plein ou refusé : pas vital */ });
        }
        return rep;
      })
      .catch(function () {
        return caches.match(cle(url)).then(function (c) {
          if (c) return c;
          return new Response(
            '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>Hors connexion</title></head>' +
            '<body style="font-family:-apple-system,sans-serif;padding:32px;text-align:center;color:#171f36;">' +
            '<h2>Pas de connexion</h2>' +
            '<p>Cette appli n\'a pas encore de copie enregistree dans ce telephone.</p>' +
            '<p>Ouvre-la une fois <b>avec Internet</b> : ensuite elle s\'ouvrira meme sans reseau.</p>' +
            '<p style="color:#5a6478;font-size:.9rem;margin-top:24px;">Tes donnees sont intactes dans le telephone.</p>' +
            '</body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        });
      })
  );
}
