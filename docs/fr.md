# Samsung Smart TV

Pilotez vos téléviseurs Samsung (Tizen, modèles 2016 et suivants) depuis Gladys, entièrement sur le réseau local :
aucun compte Samsung, aucun passage par le cloud.

## Ce que l'intégration expose

| Fonctionnalité | Détail                                                           |
| -------------- | ---------------------------------------------------------------- |
| Power          | Éteint la TV, et la rallume par Wake-on-LAN                      |
| Volume         | Curseur de 0 à 100 %, avec le niveau réel relu sur la TV         |
| Volume + / −   | Un cran de volume, comme sur la télécommande                     |
| Sourdine       | Activée ou coupée, sans effet de bascule                         |
| Source         | TV, HDMI, et les applications installées quand la TV les déclare |

## Installation

1. **Allumez votre téléviseur**, puis ouvrez l'onglet **Découverte** et lancez un scan. Il apparaît sous son propre
   nom (« Samsung AU7025 55 TV », par exemple). Créez-le.

   Une TV en veille coupe son interface réseau : elle ne répond à rien et aucun scan ne peut la détecter. Un scan
   qui ne remonte rien est presque toujours un téléviseur éteint — allumez-le et relancez.

2. Actionnez une première commande, par exemple **Volume +**. La TV affiche alors une demande d'autorisation pour
   « Gladys » : **acceptez-la avec la télécommande**. Cela n'arrive qu'une seule fois, le jeton est ensuite conservé.

Si la TV ne demande rien et que les commandes échouent, vérifiez que
_Paramètres → Général → Gestionnaire de périphériques externes → Gestionnaire de connexion des périphériques_
autorise bien les nouveaux appareils.

## Rallumer la TV

Une TV éteinte ne répond plus sur le réseau : la seule façon de la réveiller est le Wake-on-LAN, un paquet que
Gladys émet vers son adresse MAC. Il faut pour cela activer le réveil réseau sur la TV, dans
_Paramètres → Général → Réseau → Paramètres experts → **Activer avec mobile**_ (le libellé varie selon les modèles :
« Allumage à distance », « Réveil par réseau »).

En Wi-Fi, ce réveil dépend du modèle et n'est pas garanti par tous les téléviseurs. Si l'allumage ne fonctionne pas
alors que l'option est active, une liaison Ethernet le rend fiable. L'extinction, elle, fonctionne dans tous les cas.

**Pour savoir où vous en êtes**, éteignez la TV puis, depuis une machine du réseau, lancez `ping <adresse IP de la TV>` :

- la TV répond encore : son interface réseau reste active en veille, le Wake-on-LAN a toutes ses chances ;
- la TV ne répond plus du tout : elle a coupé son interface réseau, aucun paquet ne peut plus l'atteindre et le
  réveil échouera. C'est le symptôme d'un réveil réseau désactivé — activez l'option ci-dessus, puis refaites le test.

## Sources et applications

TV et HDMI sont toujours proposées : ce sont des touches de la télécommande, présentes sur tous les modèles.

La liste des applications installées est demandée à la TV lors du scan, mais plusieurs modèles récents (2021 et
suivants) ignorent cette requête. Le cas échéant, seules TV et HDMI apparaissent — c'est le comportement attendu, pas
une panne. Relancez un scan après avoir installé une application : si votre modèle répond, elle sera ajoutée.

## Fonctionnement interne

Trois canaux, chacun pour ce qu'il fait de mieux :

- l'**API REST** de la TV (port 8001) donne l'état allumé/éteint, relu à chaque rafraîchissement ;
- l'**UPnP RenderingControl** (port 9197) lit et écrit le volume et la sourdine, sans jeton et sans ambiguïté ;
- le **WebSocket télécommande** (port 8002) transporte les touches, seule partie nécessitant l'autorisation.

Le jeton d'appairage est conservé dans le volume `/data` de l'intégration : il survit aux redémarrages et aux mises
à jour du conteneur.
