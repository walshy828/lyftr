package com.lyftr.phone.sync

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.lyftr.shared.WearPaths
import com.lyftr.shared.WearSession
import kotlinx.coroutines.tasks.await

private const val TAG = "LyftrSync"

private const val FIELD_ACTIVE = "active"
private const val FIELD_SESSION_JSON = "session_json"
private const val FIELD_UPDATED_AT = "updated_at"

/** Publishes the current session to the paired watch over the Data Layer. */
class WearBridge(context: Context) {
    private val dataClient = Wearable.getDataClient(context.applicationContext)
    private val nodeClient = Wearable.getNodeClient(context.applicationContext)

    suspend fun publish(session: WearSession?) {
        // A successful putDataItem() below only means Play Services accepted
        // the write locally — it says nothing about whether any watch is
        // actually connected to receive it. Log connected nodes every time
        // so a "publish: ok" with zero nodes is unambiguous in logcat.
        runCatching { nodeClient.connectedNodes.await() }
            .onSuccess { nodes ->
                Log.d(TAG, "WearBridge: connected nodes=${nodes.size} ${nodes.map { "${it.displayName}(nearby=${it.isNearby})" }}")
            }
            .onFailure { Log.e(TAG, "WearBridge: connectedNodes lookup failed", it) }

        val request = PutDataMapRequest.create(WearPaths.SESSION).apply {
            dataMap.putBoolean(FIELD_ACTIVE, session != null)
            dataMap.putString(FIELD_SESSION_JSON, session?.toJson() ?: "")
            dataMap.putLong(FIELD_UPDATED_AT, System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()
        runCatching { dataClient.putDataItem(request).await() }
            .onSuccess { Log.d(TAG, "WearBridge.publish: ok, active=${session != null}") }
            .onFailure { Log.e(TAG, "WearBridge.publish: failed", it) }
    }
}
