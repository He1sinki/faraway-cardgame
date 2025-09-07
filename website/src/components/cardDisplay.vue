<script>
import Card from './card.vue'
export default{
    name:"CardDisplay",
    components:{
        Card
    },
    props:{
        cardsNumber: Number,
        cards: Array,
        fill: Boolean,
        flipped: {
            type: Boolean,
            default: false
        },
        // Permet de retourner uniquement certaines cartes (indexes) face cachée
        flippedIndexes: {
            type: Array,
            default: () => []
        },
        isSanctuary:{
            type:Boolean,
            default:false
        },
        locked: {
            type: Array,
            default: []
        }
    },
    methods:{
        cardClickedHandle(id){
            this.$emit("cardClicked", id)
        }
    }
}
</script>

<template>
    <div class="cardDisplay" :class="{'sanctuaryDisplayHead':isSanctuary}">
        <div class="cardGrid" :style="{'width': cardsNumber*11 + 'vw', }" :class="{'sanctuaryDisplay':isSanctuary, 'scroll':isSanctuary}">
            <Card v-for="(card, i) in cards" :id="card" :isSanctuary="isSanctuary" :isFlipped="flipped || flippedIndexes.includes(i)" :isLocked="locked.includes(i)" @cardClicked="cardClickedHandle"/>
            <Card v-if="fill" v-for="i in cardsNumber-cards.length" :isPlaceholder="true" :placeHolderNumber="cardsNumber-cards.length-i+1"/>
            <div v-if="cards.length == 0 && isSanctuary" class="sanctuaryText">No sanctuaries, yet!</div>
        </div>
    </div>
</template>


<style scoped>
.sanctuaryDisplayHead{
    /* padding: 1vw !important; */
    max-height: 16vh;
}
.sanctuaryDisplay{
    display: flex;
    justify-content: flex-start !important;
    align-items: stretch !important; /* Ensures children take full height */
    gap: 10px;
    flex-direction: row !important;
    overflow-y: hidden;
    flex-wrap: nowrap !important;
    height: 100%; /* Ensures it fills the parent */
}
.sanctuaryText{
    color: var(--grey);
    font-size: 1.5em;
    text-align: center;
    flex: 1; /* Makes it take the remaining space */
    display: flex;
    justify-content: center;
    align-items: center;
}
.cardDisplay{
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    height:100%;
    padding: 0.8vw;

    max-width: 50vw;

    border: solid 2px var(--main);
    border-radius: 15px;
}
.cardGrid{
    display: flex;
    flex-wrap: wrap;
    /* grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); */
    justify-content: center;
    align-items: center;
    gap: 10px;
    max-height: 47vh;
    max-width:40vw;
    /* overflow-x: auto; */
}
@media (max-width: 800px){
    .cardGrid{
        flex-direction: column;
    }
}
</style>