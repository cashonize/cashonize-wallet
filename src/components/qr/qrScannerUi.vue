<script setup lang="ts">
  defineProps<{
    filterHint: string;
  }>();
</script>

<template>
  <div class="scanner-box" ref="box">
    <div class="scan-layout-design">
      <div class="scan-design1">
        <div class="line-design1"></div>
      </div>
      <div class="scan-design2">
        <div class="line-design2"></div>
      </div>
      <div class="scan-design3">
        <div class="line-design3"></div>
      </div>
      <div class="scan-design4">
        <div class="line-design4"></div>
      </div>
    </div>
    <span class="scanner-text text-center full-width">Scan QR Code</span>
		<span class="scanner-text text-center full-width" style="top: 315px; color: tomato;">{{ filterHint }}</span>
  </div>
</template>

<style scoped>
/* Scanner UI */
.scanner-text {
	position: absolute;
	bottom: -30px;
	color: white;
	z-index: 1000;
}
.scanner-box {
	position: relative !important;
	display: flex !important;
	height: 280px !important;
	width: 280px !important;
	border-radius: 16% !important;
	box-shadow: 0px 0px 0px 1000px rgba(0, 0, 0, 0.6);
	vertical-align: middle;
	z-index: 2000 !important;
	align-self: center;
	margin-left: auto;
	margin-right: auto;
}
.scan-design1 {
	position: absolute;
	height: 24px;
	width: 24px;
	left: 10px;
	top: 10px;
	overflow: hidden;
}
.line-design1 {
	height: 150px;
	width: 150px;
	border: 3px solid;
	border-color: var(--color-primary);
	border-radius: 15%;
}
.scan-design2 {
	position: absolute;
	height: 24px;
	width: 24px;
	right: 10px;
	top: 10px;
	overflow: hidden;
}
.line-design2 {
	position: absolute;
	height: 150px;
	width: 150px;
	right: 0px;
	top: 0px;
	border: 3px solid;
	border-color: var(--color-primary);
	border-radius: 15%;
}
.scan-design3 {
	position: absolute;
	height: 24px;
	width: 24px;
	right: 10px;
	bottom: 10px;
	overflow: hidden;
}
.line-design3 {
	position: absolute;
	height: 150px;
	width: 150px;
	right: 0px;
	bottom: 0px;
	border: 3px solid;
	border-color: var(--color-primary);
	border-radius: 15%;
}
.scan-design4 {
	position: absolute;
	height: 24px;
	width: 24px;
	left: 10px;
	bottom: 10px;
	overflow: hidden;
}
.line-design4 {
	position: absolute;
	height: 150px;
	width: 150px;
	left: 0px;
	bottom: 0px;
	border: 3px solid;
	border-color: var(--color-primary);
	border-radius: 15%;
}
</style>