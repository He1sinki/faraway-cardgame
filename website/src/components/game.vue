<script>
import socket from "../functions/socket.js";
import cardDisplay from "./cardDisplay.vue";

export default {
    name: "Game",
    components: { cardDisplay },
    data(){
        return {
            game: { state: false },
            roomId: "",
            userProfile: {},
            titleState: "Players play",
            detailsState: "Choose a card to play",
            opponentsBaseline: {}
        }
    },
    computed:{
        otherPlayers(){
            if(!this.game || !this.game.users) return [];
            return this.game.users.filter(u => u !== socket.id);
        }
    },
    mounted(){
        this.roomId = this.$route.params.id;
        if(socket.id == null){
            socket.connect();
            socket.on("wellConnected", ()=> this.joinRoom(this.roomId));
        }
        socket.on("roomFull", ()=>{ alert("Room is full"); this.$router.push("/"); });
        socket.on("roomNotFound", ()=>{ alert("Room not found"); this.$router.push("/"); });
        socket.on("roomStarted", ()=>{ alert("Room has already started"); this.$router.push("/"); });
        socket.on("update", g => this.updateGame(g));
        socket.on("roomJoined", g => this.game = g);
    },
    methods:{
        joinRoom(room){ socket.emit("joinRoom", room); },
        startGame(){ socket.emit('startGame', this.roomId); },
        updateGame(game){
            const prevPhase = this.game.phase;
            this.game = game;
            this.userProfile = (this.game.players || {})[socket.id] || {};
            if(this.game.phase === 'play' && prevPhase !== 'play'){
                const b = {};
                for(const uid of this.otherPlayers){ b[uid] = this.game.players[uid].playedCards.length; }
                this.opponentsBaseline = b;
            }
            switch(this.game.phase){
                case 'play':
                    this.titleState = 'Players play';
                    this.detailsState = this.userProfile.hasPlayed? 'Waiting others' : 'Choose a card to play';
                    break;
                case 'shop':
                    this.titleState = this.userProfile.hasToChoose? 'Choose a card' : 'Shop phase';
                    this.detailsState = this.userProfile.hasToChoose? 'Pick one card' : 'Waiting others';
                    break;
                case 'sanctuary':
                    this.titleState = this.userProfile.hasToChoose? 'Choose a sanctuary' : 'Sanctuary phase';
                    this.detailsState = this.userProfile.hasToChoose? 'Pick one sanctuary' : 'Waiting others';
                    break;
                case 'end':
                    this.titleState = 'Game over';
                    this.detailsState = '';
                    break;
            }
        },
        leaveRoom(){ socket.emit("leaveRoom"); this.$router.push("/"); },
        copyUrl(){ navigator.clipboard.writeText(window.location.href); },
        cardClickedHandle(card){ if(this.game.phase==='play' && !this.userProfile.hasPlayed){ socket.emit('playCard', card); } },
        shopClickedHandle(card){ if(this.game.phase==='shop' && this.userProfile.hasToChoose){ socket.emit('shopChooseCard', card); } },
        sanctuaryChooseClick(card){ if(this.game.phase==='sanctuary' && this.userProfile.hasToChoose){ socket.emit('sanctuaryChoose', card); } }
    }
}
</script>

<template>
    <div class="mainDiv">
        <div class="waitingScreen" v-if="!game.state">
            <h1>Waiting for players ({{ (game.users && game.users.length) || 1 }}/{{ game.maxPlayers || 6 }})...</h1>
            <div class="room">
                <h2>Room: {{ roomId }}</h2>
                <img class="smallImg" @click="copyUrl" src="../../clipboard.svg" />
            </div>
            <div class="btn" v-if="game.users && game.users.length>=2" @click="startGame">Start game</div>
            <div class="btn" @click="leaveRoom">Leave room</div>
        </div>
        <div class="gameDiv" v-else>
            <!-- AUTRES JOUEURS -->
            <div class="othersWrapper">
                <div class="playerMini" v-for="uid in otherPlayers" :key="uid">
                    <div class="miniTitle">Player {{ game.users.indexOf(uid)+1 }}</div>
                        <cardDisplay cardsNumber="8" :cards="game.players[uid].playedCards" :fill="true" />
                    <div class="miniSide">
                        <cardDisplay cardsNumber="3" :cards="game.players[uid].hand" :flipped="true" :locked="[0,1,2]" />
                        <cardDisplay cardsNumber="3" :cards="game.players[uid].playedSanctuaries" :isSanctuary="true" />
                    </div>
                    <div class="statusTag" :class="{'toChoose':game.players[uid].hasToChoose, 'done':game.players[uid].hasPlayed}">
                        {{ game.players[uid].hasToChoose? 'Choosing' : (game.players[uid].hasPlayed? 'Done':'Playing') }}
                    </div>
                </div>
            </div>

            <!-- PHASE CENTRALE -->
            <div class="centerDiv" v-if="game.phase!=='end'">
                <cardDisplay cardsNumber="3" :cards="userProfile.sanctuaryChoose" :fill="false" @cardClicked="sanctuaryChooseClick" :isSanctuary="true" v-if="game.phase==='sanctuary' && userProfile.hasToChoose" />
                <div class="gameState" v-else>
                    <div id="titleState">{{ titleState }}</div>
                    <div id="detailsState">{{ detailsState }}</div>
                </div>
                <cardDisplay :cardsNumber="Math.max(4, ((game.users && game.users.length) || 2)+1)" :cards="game.shop" :fill="false" @cardClicked="shopClickedHandle" />
            </div>

            <div class="centerDiv" v-else>
                <table class="scoreTable" v-if="game.score && game.score.length">
                    <thead>
                        <tr>
                            <th>Player</th>
                            <th v-for="(round, rIdx) in game.score[0].round" :key="'h'+rIdx">{{ rIdx!=8 ? 'Round '+ (rIdx+1) : 'Sanctuaries' }}</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(uid, idx) in game.users" :key="'s'+uid">
                            <td>Player {{ idx+1 }} <span v-if="Array.isArray(game.winner) && game.winner.includes(uid)">🏆</span></td>
                            <td v-for="(round, rIdx) in game.score[idx].round" :key="'r'+idx+'-'+rIdx">{{ round }}</td>
                            <td>{{ game.score[idx].total }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- JOUEUR LOCAL -->
            <div class="playerHand">
                <cardDisplay cardsNumber="8" :cards="userProfile.playedCards" :fill="true" />
                <div class="sideCards">
                    <cardDisplay cardsNumber="3" :cards="userProfile.hand" @cardClicked="cardClickedHandle" />
                    <cardDisplay cardsNumber="3" :cards="userProfile.playedSanctuaries" :isSanctuary="true" />
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
#titleState{
    font-size: 2em;
    font-weight: bold;
}
#detailsState{
    font-size: 1.5em;
    color: var(--grey);
}
.mainDiv{
    padding: 20px;
}
.sideCards{
    display: flex;
    flex-direction: column;
    gap: 20px;
    flex: 1; /* Makes it take the full available height */
    min-height: 0; /* Prevents overflow issues */
}
.centerDiv{
    width: 100%;
    display: flex;
    flex-direction: row;
    gap: 5vw;
    justify-content: flex-end;
    align-items: center;
    overflow-x: auto;
    white-space: nowrap;
    height: 100%;
    flex: 1; /* Make it take up the remaining space */
    min-height: 0; /* Ensure it shrinks properly */
}
.gameState{
    border: solid 2px var(--main);
    border-radius: 15px;
    padding: 20px;
    height: 100%;
    width: 100%;
    white-space: nowrap;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
}
.cardDisplay {
    flex: 1;
}
.gameState > h3{
    color: var(--grey)
}
.gameDiv{
    display:flex;
    flex-direction:column;
    gap:20px;
    align-items:center;
    height: 95vh;
}
.playerHand{
    display:flex;
    flex-direction: row;
    gap: 5vw;
    justify-content: center;
    align-items: center;
    max-height:36vh;
    
}
.othersWrapper{display:flex;flex-wrap:wrap;gap:10px;width:100%;justify-content:center;}
.playerMini{border:2px solid var(--main);border-radius:12px;padding:10px;width:300px;display:flex;flex-direction:column;gap:8px;position:relative;}
.miniSide{display:flex;gap:8px;}
.miniTitle{font-weight:bold;}
.statusTag{position:absolute;top:6px;right:8px;font-size:0.7em;padding:4px 6px;border-radius:8px;background:var(--grey);color:#fff;}
.statusTag.toChoose{background:#d97706;}
.statusTag.done{background:#16a34a;}
.othersWrapper{
    display:flex;
    flex-wrap:wrap;
    gap:10px;
    width:100%;
    justify-content:center;
}
.playerMini{
    border:2px solid var(--main);
    border-radius:12px;
    padding:10px;
    width:300px;
    display:flex;
    flex-direction:column;
    gap:8px;
    position:relative;
}
.miniSide{display:flex;gap:8px;}
.miniTitle{font-weight:bold;}
.statusTag{position:absolute;top:6px;right:8px;font-size:0.7em;padding:4px 6px;border-radius:8px;background:var(--grey);color:#fff;}
.statusTag.toChoose{background:#d97706;}
.statusTag.done{background:#16a34a;}
/* responsive make it a column */
@media (max-width: 800px){
    .playerHand{
        flex-direction: column;
    }
    .centerDiv{
        flex-direction: column;
    }
}
.smallImg{
    width:20px;
    height:20px;
    cursor:pointer;
}
.room{
    display:flex;
    gap:10px;
    align-items:center;
}
.mainDiv{
    display: flex;
    flex-direction: column;
    align-items: center;
    width:100%;
}
.waitingScreen{
    display:flex;
    flex-direction:column;
    justify-content: center;
    align-items: center;
    width:100%;
    gap:50px;
    height:100vh;
}
.scoreTable {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
    font-size: 1em;
    text-align: center;
}
.scoreTable th, .scoreTable td {
    padding: 12px 15px;
    border: 1px solid #ddd;
}
.scoreTable thead tr {
    background-color: var(--main);
    color: #ffffff;
    text-align: center;
}
.btn {
    white-space: nowrap;
}
</style>