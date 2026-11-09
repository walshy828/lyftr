package com.baseline.phone.sync

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.baseline.shared.WearFields
import com.baseline.shared.WearPaths
import com.baseline.shared.WearSession
import kotlinx.coroutines.tasks.await

private const val TAG = "BaselineSync"

/** Publishes the current session to the paired watch over the Data Layer. */
class WearBridge(context: Context) {
    private val dataClient = Wearable.getDataClient(context.applicationContext)

    suspend fun publish(session: WearSession?) {
        val request = PutDataMapRequest.create(WearPaths.SESSION).apply {
            dataMap.putBoolean(WearFields.ACTIVE, session != null)
            dataMap.putString(WearFields.SESSION_JSON, session?.toJson() ?: "")
            dataMap.putLong(WearFields.UPDATED_AT, System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()
        runCatching { dataClient.putDataItem(request).await() }
            .onFailure { Log.e(TAG, "WearBridge.publish failed", it) }
    }
}
